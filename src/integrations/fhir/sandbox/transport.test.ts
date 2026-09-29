import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signJwt, signerForPrivateKey } from "@/lib/crypto/jwt-sign";
import { buildClientAssertion, CLIENT_ASSERTION_TYPE, requestAccessToken } from "../auth";
import { discover } from "../discovery";
import { EnvSharedKeyStore } from "../keys";
import { FHIR_JSON, FORM_URLENCODED, JSON_CONTENT, type TransportResponse } from "../transport";
import { SANDBOX_BASE_URL, SANDBOX_CLIENT_ID, SANDBOX_TOKEN_ENDPOINT } from "../url-rules";
import {
  SANDBOX_FIXTURES,
  SANDBOX_PATIENT_COUNT,
  SANDBOX_SYNTHETIC_TAG,
  SandboxDataset,
  sandboxMinorBirthDate,
  sandboxPatientId,
} from "./dataset";
import { SandboxNotPermittedError, SandboxState, SandboxTransport } from "./transport";

// docs/specs/patient-integrations.md PI2b "Synthetic sandbox": an in-process synthetic FHIR server that
// satisfies discovery and the token request (verifying the assertion: signature, algorithm allow-list,
// `aud`, `exp`, `jti` remembered until `exp`) and serves deterministic synthetic patients, and only
// where only synthetic data is allowed. Everything here is synthetic.

const pem = (key: ReturnType<typeof generateKeyPairSync>["privateKey"]) =>
  key.export({ format: "pem", type: "pkcs8" }).toString();
const ecKey = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey;
const store = new EnvSharedKeyStore(() => true, pem(ecKey));
const signer = signerForPrivateKey(ecKey, await store.kid());

let clock = new Date("2026-09-28T12:00:00.000Z");
function build(
  options: { synthetic?: () => boolean; keys?: () => ReturnType<typeof store.publicJwks> } = {},
) {
  return new SandboxTransport({
    publicKeys: options.keys ?? (() => store.publicJwks()),
    synthetic: options.synthetic ?? (() => true),
    now: () => clock,
    state: new SandboxState(),
  });
}
const url = (path: string) => new URL(`${SANDBOX_BASE_URL}${path}`);

async function tokenFor(
  transport: SandboxTransport,
  scopes = "system/Patient.rs system/Coverage.rs system/Organization.rs",
) {
  const grant = await requestAccessToken({
    transport,
    tokenEndpoint: SANDBOX_TOKEN_ENDPOINT,
    clientId: SANDBOX_CLIENT_ID,
    signer,
    scopes,
    now: clock,
  });
  return grant.token.reveal();
}
const fhirGet = (transport: SandboxTransport, target: URL, token?: string) =>
  transport.request({
    url: target,
    method: "GET",
    accept: [FHIR_JSON],
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
/** The parsed body, untyped on purpose: the tests probe its shape. */
const json = (response: TransportResponse): ReturnType<typeof JSON.parse> => JSON.parse(response.body);

function tokenPost(transport: SandboxTransport, assertion: string, extra: Record<string, string> = {}) {
  return transport.request({
    url: new URL(SANDBOX_TOKEN_ENDPOINT),
    method: "POST",
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "system/Patient.rs",
      client_assertion_type: CLIENT_ASSERTION_TYPE,
      client_assertion: assertion,
      ...extra,
    }).toString(),
    contentType: FORM_URLENCODED,
    accept: [JSON_CONTENT],
  });
}
const claims = (overrides: Record<string, unknown> = {}) => {
  const iat = Math.floor(clock.getTime() / 1000);
  return {
    iss: SANDBOX_CLIENT_ID,
    sub: SANDBOX_CLIENT_ID,
    aud: SANDBOX_TOKEN_ENDPOINT,
    iat,
    exp: iat + 240,
    jti: randomUUID(),
    ...overrides,
  };
};

describe("SandboxTransport — where it may exist", () => {
  it("refuses to be built where real data is allowed, and refuses a request if the environment flips", async () => {
    expect(() => build({ synthetic: () => false })).toThrow(SandboxNotPermittedError);
    let synthetic = true;
    const transport = build({ synthetic: () => synthetic });
    synthetic = false;
    await expect(fhirGet(transport, url("/metadata"))).rejects.toBeInstanceOf(SandboxNotPermittedError);
  });

  it("answers only for the sandbox origin: another host, scheme, port, or credentials is unreachable", async () => {
    const transport = build();
    for (const target of [
      "https://fhir.example.com/r4/metadata",
      "http://sandbox.fhir.denialdesk.invalid/r4/metadata",
      "https://sandbox.fhir.denialdesk.invalid:8443/r4/metadata",
      "https://user:pw@sandbox.fhir.denialdesk.invalid/r4/metadata",
      "https://evil.sandbox.fhir.denialdesk.invalid/r4/metadata",
    ]) {
      await expect(fhirGet(transport, new URL(target))).rejects.toMatchObject({ code: "unreachable" });
    }
  });

  it("checks Content-Type against `accept` like the real transport", async () => {
    await expect(
      build().request({ url: url("/metadata"), method: "GET", accept: [JSON_CONTENT] }),
    ).rejects.toMatchObject({ code: "content_type_refused" });
  });

  it("answers nothing under an unknown path, and delivers no body for a non-2xx", async () => {
    const transport = build();
    expect(await fhirGet(transport, url("/nope"), await tokenFor(transport))).toMatchObject({
      status: 404,
      body: "",
    });
    expect(
      await fhirGet(transport, new URL("https://sandbox.fhir.denialdesk.invalid/elsewhere")),
    ).toMatchObject({
      status: 404,
      body: "",
    });
    // An unauthenticated request for a resource is a 401, whether or not it exists.
    expect(await fhirGet(transport, url("/nope"))).toMatchObject({ status: 401, body: "" });
  });
});

describe("SandboxTransport — discovery", () => {
  it("passes real discovery: FHIR 4.0.1, SMART private_key_jwt with ES384/RS384, the pinned token endpoint, the base URL as issuer", async () => {
    const found = await discover(build(), SANDBOX_BASE_URL, { sandbox: true });
    expect(found).toMatchObject({
      tokenEndpoint: SANDBOX_TOKEN_ENDPOINT,
      tokenEndpointAdvertised: SANDBOX_TOKEN_ENDPOINT,
      tokenEndpointKey: SANDBOX_TOKEN_ENDPOINT,
      issuer: SANDBOX_BASE_URL,
      scopeStyle: "v2",
    });
    expect(found.algs).toEqual(["ES384", "RS384"]);
  });

  it("is not discoverable as a real connection (the token host is the sandbox's)", async () => {
    await expect(discover(build(), SANDBOX_BASE_URL, { sandbox: false })).rejects.toMatchObject({
      outcome: "smart_config_invalid",
    });
  });
});

describe("SandboxTransport — the token endpoint verifies the assertion", () => {
  it("issues a bearer token, with the scopes it knows, to a valid assertion", async () => {
    const transport = build();
    const response = await tokenPost(
      transport,
      await buildClientAssertion({
        clientId: SANDBOX_CLIENT_ID,
        tokenEndpoint: SANDBOX_TOKEN_ENDPOINT,
        signer,
        now: clock,
      }),
      {
        scope: "system/Patient.rs system/Coverage.rs system/Admin.all",
      },
    );
    expect(response.status).toBe(200);
    expect(json(response)).toMatchObject({
      token_type: "bearer",
      expires_in: 300,
      scope: "system/Patient.rs system/Coverage.rs",
    });
    expect(json(response).access_token).toMatch(/^sandbox-token-/);
  });

  async function refused(transport: SandboxTransport, assertion: string) {
    const response = await tokenPost(transport, assertion);
    expect(response).toMatchObject({ status: 401, body: "" });
  }

  it("refuses an assertion signed by another key, a tampered payload, and a truncated signature", async () => {
    const transport = build();
    const other = signerForPrivateKey(
      generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey,
      signer.kid,
    );
    await refused(transport, await signJwt(other, claims()));
    const good = await signJwt(signer, claims());
    const [h, p, s] = good.split(".");
    const tampered = Buffer.from(JSON.stringify({ ...claims(), sub: "someone-else" })).toString("base64url");
    await refused(transport, `${h}.${tampered}.${s}`);
    await refused(transport, `${h}.${p}.${s!.slice(0, 20)}`);
    await refused(transport, `${h}.${p}`);
    await refused(transport, "");
  });

  it("refuses an algorithm off the allow-list (none, HS256), a missing or unknown kid, and a missing typ", async () => {
    const transport = build();
    const forge = (header: Record<string, unknown>, payload: Record<string, unknown> = claims()) =>
      `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.AAAA`;
    await refused(transport, forge({ alg: "none", typ: "JWT", kid: signer.kid }));
    await refused(transport, forge({ alg: "HS256", typ: "JWT", kid: signer.kid }));
    await refused(transport, forge({ alg: "ES384", typ: "JWT" }));
    await refused(transport, forge({ alg: "ES384", typ: "JWT", kid: "unknown-kid" }));
    await refused(transport, forge({ alg: "RS384", typ: "JWT", kid: signer.kid }));
    await refused(transport, forge({ alg: "ES384", kid: signer.kid }));
  });

  it("refuses the wrong audience, issuer or subject", async () => {
    const transport = build();
    await refused(transport, await signJwt(signer, claims({ aud: "https://elsewhere.example.com/token" })));
    await refused(transport, await signJwt(signer, claims({ iss: "another-client" })));
    await refused(transport, await signJwt(signer, claims({ sub: "another-client" })));
    await refused(transport, await signJwt(signer, claims({ jti: undefined })));
    await refused(transport, await signJwt(signer, claims({ jti: "" })));
  });

  it("checks exp at the boundary: valid until exp, refused at and after it, and never longer than five minutes", async () => {
    const transport = build();
    const now = Math.floor(clock.getTime() / 1000);
    await tokenPost(transport, await signJwt(signer, claims({ iat: now - 100, exp: now + 1 }))).then((r) =>
      expect(r.status).toBe(200),
    );
    await refused(transport, await signJwt(signer, claims({ iat: now - 100, exp: now })));
    await refused(transport, await signJwt(signer, claims({ iat: now - 100, exp: now - 1 })));
    // A lifetime of exactly five minutes is allowed; one second more is not.
    await tokenPost(transport, await signJwt(signer, claims({ iat: now, exp: now + 300 }))).then((r) =>
      expect(r.status).toBe(200),
    );
    await refused(transport, await signJwt(signer, claims({ iat: now, exp: now + 301 })));
    // An `iat` far in the future is refused.
    await refused(transport, await signJwt(signer, claims({ iat: now + 61, exp: now + 120 })));
  });

  it("remembers each jti until its exp: a replay is refused, and a different jti is fine", async () => {
    const transport = build();
    const jti = "replayed-jti-1";
    const assertion = await signJwt(signer, claims({ jti }));
    expect((await tokenPost(transport, assertion)).status).toBe(200);
    await refused(transport, assertion);
    expect((await tokenPost(transport, await signJwt(signer, claims({ jti: "fresh-jti" })))).status).toBe(
      200,
    );
  });

  it("forgets a jti once it has expired, so its memory stays bounded", async () => {
    const state = new SandboxState();
    expect(state.rememberJti("a", 1000, 0)).toBe(true);
    expect(state.rememberJti("a", 1000, 999_999)).toBe(false);
    expect(state.rememberJti("a", 2000, 1_000_000)).toBe(true);
    expect(state.jtis.size).toBe(1);
  });

  it("prunes expired access tokens when it issues a new one, so the token map stays bounded (PR #98 review)", async () => {
    const state = new SandboxState();
    const transport = new SandboxTransport({
      publicKeys: () => store.publicJwks(),
      synthetic: () => true,
      now: () => clock,
      state,
    });
    const start = clock;
    try {
      const first = await tokenFor(transport);
      expect(state.tokens.has(first)).toBe(true);
      clock = new Date(start.getTime() + 301_000);
      // The expired token is refused and dropped on use.
      expect((await fhirGet(transport, url("/Patient"), first)).status).toBe(401);
      expect(state.tokens.has(first)).toBe(false);
      const second = await tokenFor(transport);
      clock = new Date(start.getTime() + 700_000);
      await tokenFor(transport);
      expect(state.tokens.has(second)).toBe(false);
      expect(state.tokens.size).toBe(1);
    } finally {
      clock = start;
    }
  });

  it("binds an access token to the key set that obtained it: another key set gets 401 (PR #98 review)", async () => {
    const state = new SandboxState();
    const otherKey = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey;
    const otherStore = new EnvSharedKeyStore(() => true, pem(otherKey));
    const options = { synthetic: () => true, now: () => clock, state };
    const one = new SandboxTransport({ ...options, publicKeys: () => store.publicJwks() });
    const two = new SandboxTransport({ ...options, publicKeys: () => otherStore.publicJwks() });
    const token = await tokenFor(one);
    expect((await fhirGet(one, url("/Patient"), token)).status).toBe(200);
    // Same shared state, same token string, different key set: refused.
    expect((await fhirGet(two, url("/Patient"), token)).status).toBe(401);
    // And a key that has been rotated out of the set no longer opens the token.
    const rotated = new SandboxTransport({ ...options, publicKeys: async () => [] });
    expect((await fhirGet(rotated, url("/Patient"), token)).status).toBe(401);
  });

  it("does not remember the jti of an assertion that failed another check", async () => {
    const transport = build();
    const jti = "failed-first";
    await refused(
      transport,
      await signJwt(signer, claims({ jti, aud: "https://elsewhere.example.com/token" })),
    );
    expect((await tokenPost(transport, await signJwt(signer, claims({ jti })))).status).toBe(200);
  });

  it("refuses a wrong grant type, an unsupported assertion type, and a non-form body", async () => {
    const transport = build();
    const assertion = await signJwt(signer, claims());
    expect((await tokenPost(transport, assertion, { grant_type: "authorization_code" })).status).toBe(400);
    expect((await tokenPost(transport, assertion, { client_assertion_type: "x" })).status).toBe(401);
    const wrongType = await transport.request({
      url: new URL(SANDBOX_TOKEN_ENDPOINT),
      method: "POST",
      body: "{}",
      contentType: "application/json",
      accept: [JSON_CONTENT],
    });
    expect(wrongType.status).toBe(415);
    expect((await fhirGet(transport, new URL(SANDBOX_TOKEN_ENDPOINT))).status).toBe(405);
  });

  it("verifies against the public keys it is given, so rotating them changes who is accepted", async () => {
    const newKey = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey;
    const rotated = new EnvSharedKeyStore(() => true, pem(newKey));
    const transport = build({ keys: () => rotated.publicJwks() });
    await refused(transport, await signJwt(signer, claims()));
    const newSigner = signerForPrivateKey(newKey, await rotated.kid());
    expect((await tokenPost(transport, await signJwt(newSigner, claims()))).status).toBe(200);
  });
});

describe("SandboxTransport — FHIR requests need a valid token", () => {
  it("refuses a missing, unknown, malformed, or expired bearer token", async () => {
    const transport = build();
    expect((await fhirGet(transport, url("/Patient?_count=1"))).status).toBe(401);
    expect((await fhirGet(transport, url("/Patient?_count=1"), "made-up")).status).toBe(401);
    const token = await tokenFor(transport);
    expect((await fhirGet(transport, url("/Patient?_count=1"), token)).status).toBe(200);
    const before = clock;
    clock = new Date(clock.getTime() + 300_000);
    expect((await fhirGet(transport, url("/Patient?_count=1"), token)).status).toBe(401);
    clock = before;
  });

  it("answers 403 to a search the token's scopes don't cover", async () => {
    const transport = build();
    const token = await tokenFor(transport, "system/Coverage.rs");
    expect((await fhirGet(transport, url("/Patient?_count=1"), token)).status).toBe(403);
    expect((await fhirGet(transport, url("/Coverage?patient=syn-pat-0001"), token)).status).toBe(200);
  });

  it("grants v1 (.read) scopes as well", async () => {
    const transport = build();
    const token = await tokenFor(transport, "system/Patient.read system/Coverage.read");
    expect((await fhirGet(transport, url("/Patient?_count=1"), token)).status).toBe(200);
  });
});

describe("SandboxTransport — Patient and Coverage search", () => {
  it("pages 125 patients at _count=100: a full page with a same-origin next link, then the rest", async () => {
    const transport = build();
    const token = await tokenFor(transport);
    const one = json(await fhirGet(transport, url("/Patient?_count=100"), token));
    expect(one).toMatchObject({ resourceType: "Bundle", type: "searchset", total: SANDBOX_PATIENT_COUNT });
    expect(one.entry).toHaveLength(100);
    expect(one.meta.lastUpdated).toBe(clock.toISOString());
    const next = one.link.find((link: { relation: string }) => link.relation === "next").url as string;
    expect(new URL(next).origin).toBe(new URL(SANDBOX_BASE_URL).origin);
    const two = json(await fhirGet(transport, new URL(next), token));
    expect(two.entry).toHaveLength(25);
    expect(two.link.some((link: { relation: string }) => link.relation === "next")).toBe(false);
    const ids = [...one.entry, ...two.entry].map((entry: { resource: { id: string } }) => entry.resource.id);
    expect(new Set(ids).size).toBe(SANDBOX_PATIENT_COUNT);
  });

  it("caps _count at 100, defaults it, and refuses a malformed one", async () => {
    const transport = build();
    const token = await tokenFor(transport);
    expect(json(await fhirGet(transport, url("/Patient?_count=1000"), token)).entry).toHaveLength(100);
    expect(json(await fhirGet(transport, url("/Patient"), token)).entry).toHaveLength(20);
    expect((await fhirGet(transport, url("/Patient?_count=0"), token)).status).toBe(400);
    expect((await fhirGet(transport, url("/Patient?_count=abc"), token)).status).toBe(400);
    expect((await fhirGet(transport, url("/Patient?_offset=-1"), token)).status).toBe(400);
  });

  it("filters by _lastUpdated=ge<instant>, inclusive, and refuses another prefix", async () => {
    const transport = build();
    const token = await tokenFor(transport);
    const all = json(await fhirGet(transport, url("/Patient?_count=100"), token));
    const at = all.entry[10].resource.meta.lastUpdated as string;
    const since = json(
      await fhirGet(transport, url(`/Patient?_count=100&_lastUpdated=ge${encodeURIComponent(at)}`), token),
    );
    expect(since.total).toBe(SANDBOX_PATIENT_COUNT - 10);
    expect(since.entry[0].resource.meta.lastUpdated).toBe(at);
    const none = json(
      await fhirGet(
        transport,
        url(`/Patient?_lastUpdated=ge${encodeURIComponent(clock.toISOString())}`),
        token,
      ),
    );
    expect(none.entry ?? []).toHaveLength(0);
    expect((await fhirGet(transport, url("/Patient?_lastUpdated=gt2025-01-01"), token)).status).toBe(400);
    expect((await fhirGet(transport, url("/Patient?_lastUpdated=gegarbage"), token)).status).toBe(400);
  });

  it("searches Coverage by POST _search (form body) and by GET, several patients at once", async () => {
    const transport = build();
    const token = await tokenFor(transport);
    const ids = [
      sandboxPatientId(1),
      sandboxPatientId(SANDBOX_FIXTURES.noCoverage),
      sandboxPatientId(SANDBOX_FIXTURES.secondaryCoverage),
    ];
    const post = await transport.request({
      url: url("/Coverage/_search"),
      method: "POST",
      body: new URLSearchParams({ patient: ids.join(",") }).toString(),
      contentType: FORM_URLENCODED,
      accept: [FHIR_JSON],
      headers: { authorization: `Bearer ${token}` },
    });
    const bundle = json(post);
    // Patient 1: one; the fixture with no coverage: none; the secondary fixture: two (the second is `order: 2`).
    expect(bundle.entry).toHaveLength(3);
    const get = json(await fhirGet(transport, url(`/Coverage?patient=Patient/${ids[0]}`), token));
    expect(get.entry).toHaveLength(1);
    expect(get.entry[0].resource.beneficiary.reference).toBe(`Patient/${ids[0]}`);
    // A POST with the wrong content type is refused, and so is a search with no patient.
    expect(
      (
        await transport.request({
          url: url("/Coverage/_search"),
          method: "POST",
          body: "{}",
          contentType: "application/json",
          accept: [FHIR_JSON],
          headers: { authorization: `Bearer ${token}` },
        })
      ).status,
    ).toBe(415);
    expect((await fhirGet(transport, url("/Coverage"), token)).status).toBe(400);
  });

  it("pages a Coverage POST result with a GET next link that carries the patient list", async () => {
    const transport = build();
    const token = await tokenFor(transport);
    const ids = Array.from({ length: 10 }, (_, i) => sandboxPatientId(i + 20));
    const first = json(
      await transport.request({
        url: url("/Coverage/_search"),
        method: "POST",
        body: new URLSearchParams({ patient: ids.join(","), _count: "4" }).toString(),
        contentType: FORM_URLENCODED,
        accept: [FHIR_JSON],
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(first.entry).toHaveLength(4);
    const next = new URL(first.link.find((link: { relation: string }) => link.relation === "next").url);
    expect(next.searchParams.get("patient")).toBe(ids.join(","));
    expect(json(await fhirGet(transport, next, token)).entry).toHaveLength(4);
  });
});

describe("SandboxDataset — deterministic, synthetic", () => {
  const dataset = new SandboxDataset();

  it("is identical on every construction", () => {
    expect(JSON.stringify(new SandboxDataset().patients)).toBe(JSON.stringify(dataset.patients));
  });

  it("has 125 patients, every MRN and member ID marked SYN, every resource tagged synthetic", () => {
    expect(dataset.patients).toHaveLength(SANDBOX_PATIENT_COUNT);
    for (const patient of dataset.patients) {
      const mrn = (patient.resource.identifier as { value: string }[])[0]!.value;
      expect(mrn.startsWith("SYN")).toBe(true);
      expect(JSON.stringify((patient.resource.meta as { tag: unknown[] }).tag)).toContain(
        SANDBOX_SYNTHETIC_TAG.code,
      );
      for (const coverage of patient.coverages) {
        expect((coverage.subscriberId as string).startsWith("SYN")).toBe(true);
        expect(JSON.stringify(coverage.meta)).toContain(SANDBOX_SYNTHETIC_TAG.code);
      }
    }
  });

  it("carries one fixture for each rule the mapping has", () => {
    const at = (n: number) => dataset.patient(sandboxPatientId(n))!;
    expect(at(SANDBOX_FIXTURES.inactive).resource.active).toBe(false);
    expect(JSON.stringify(at(SANDBOX_FIXTURES.replacedBy).resource.link)).toContain("replaced-by");
    expect(at(SANDBOX_FIXTURES.partialBirthDate).resource.birthDate).toBe("1985-04");
    expect(JSON.stringify(at(SANDBOX_FIXTURES.dependentCoverage).coverages)).toContain('"child"');
    expect(JSON.stringify(at(SANDBOX_FIXTURES.unmappedPayor).coverages)).toContain("syn-org-9");
    expect(JSON.stringify(at(SANDBOX_FIXTURES.nonOrganizationPayor).coverages)).toContain(
      '"reference":"Patient/',
    );
    expect(JSON.stringify(at(SANDBOX_FIXTURES.restrictedLabel).resource.meta)).toContain('"code":"R"');
    expect(JSON.stringify(at(SANDBOX_FIXTURES.hivLabel).resource.meta)).toContain('"code":"HIV"');
    expect(JSON.stringify(at(SANDBOX_FIXTURES.unknownLabel).resource.meta)).toContain("X-SYNTHETIC");
    // Relative to now, so the fixture is always a minor (PR #98 review).
    expect(at(SANDBOX_FIXTURES.minor).resource.birthDate).toBe(sandboxMinorBirthDate(new Date()));
    expect(
      new Date().getUTCFullYear() - Number(String(at(SANDBOX_FIXTURES.minor).resource.birthDate).slice(0, 4)),
    ).toBe(10);
    expect(new SandboxDataset(12, new Date("2040-06-01T00:00:00Z")).patients[10]!.resource.birthDate).toBe(
      "2030-03-01",
    );
    expect(JSON.stringify(at(SANDBOX_FIXTURES.ssnShapedMrn).resource.identifier)).toContain(
      "SYN-123-45-6789",
    );
    expect(at(SANDBOX_FIXTURES.noCoverage).coverages).toHaveLength(0);
    expect(at(SANDBOX_FIXTURES.secondaryCoverage).coverages).toHaveLength(2);
  });

  it("includes fields the sync must never read, so tests can prove it doesn't", () => {
    expect(JSON.stringify(dataset.patients[0]!.resource)).toContain("telecom");
  });

  it("patch bumps versionId and lastUpdated like an EHR edit", () => {
    const edited = new SandboxDataset();
    const at = new Date("2026-09-28T09:00:00Z");
    edited.patch(
      sandboxPatientId(30),
      (resource) => {
        resource.gender = "male";
      },
      at,
    );
    const patient = edited.patient(sandboxPatientId(30))!;
    expect((patient.resource.meta as { versionId: string }).versionId).toBe("2");
    expect((patient.resource.meta as { lastUpdated: string }).lastUpdated).toBe(at.toISOString());
    expect(patient.lastUpdated).toEqual(at);
    expect(() => edited.patch("nope", () => {}, at)).toThrow();
  });
});
