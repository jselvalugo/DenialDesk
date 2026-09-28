import { createPublicKey, generateKeyPairSync, randomUUID, verify as cryptoVerify } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, integrationConnections } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  createConnection,
  getConnection,
  IntegrationConnectionError,
  revokeConnection,
  updateConnection,
  type IntegrationActor,
} from "@/domain/integrations/connections";
import {
  hasRecentPassingTest,
  outcomeMessage,
  TEST_VALIDITY_MS,
  testConnection,
  type TestConnectionDeps,
  type TxRunner,
} from "@/domain/integrations/test-connection";
import { TransportError, type TransportErrorCode } from "@/integrations/fhir/errors";
import { EnvSharedKeyStore, SigningKeyStoreError } from "@/integrations/fhir/keys";
import {
  capabilityStatement,
  FAKE_ACCESS_TOKEN,
  FAKE_BASE_URL,
  FAKE_TOKEN_ENDPOINT,
  FakeFhirTransport,
  jsonResponse,
  smartConfiguration,
} from "../support/fake-fhir-transport";
import { createTestTenant } from "./helpers";

// docs/specs/patient-integrations.md PI2a part 2: Test connection (discovery + one token request, no
// patient data), its rate limits, audit, and the "passing test in the last 24 h" record Submit will
// require. R-7.5.1 (audit), R-7.2.4 (tenant isolation), R-7.4.7 (rate limiting).
//
// Keys come from the environment (one shared pre-production key, spec "Keys"): these tests hand the
// service an `EnvSharedKeyStore` over a key generated here, so nothing is written to `key_ref` and no
// owner-role write is needed.

type Ctx = { tenantId: string; userId: string };
let a: Ctx;
let b: Ctx;

const admin = (ctx: Ctx): IntegrationActor => ({ ...ctx, role: "admin", syntheticOnly: false });
const runner =
  (ctx: Ctx): TxRunner =>
  (fn) =>
    withTenant(ctx, fn);

const signingKey = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey;
const keyStore = new EnvSharedKeyStore(
  () => true,
  signingKey.export({ format: "pem", type: "pkcs8" }).toString(),
);

/** Pinned once per file run: every rate-limit hit lands in one window, so a window can't roll mid-test. */
const CLOCK = new Date();

function deps(transport: FakeFhirTransport | null, store: EnvSharedKeyStore = keyStore): TestConnectionDeps {
  return { transportFor: () => transport, keyStore: () => store, now: () => CLOCK };
}

// Fresh practices per test: "Test connection" is rate-limited per practice (20 per window), and the
// pinned CLOCK puts every test in the file into one window, so a shared practice would run out.
beforeEach(async () => {
  a = await createTestTenant("Test connection A");
  b = await createTestTenant("Test connection B");
});

afterAll(() => closeDatabase());

/** A draft against the fake server's base URL. */
async function draft(ctx: Ctx = a): Promise<{ id: string; clientId: string }> {
  const clientId = `client-${randomUUID().slice(0, 8)}`;
  const { id } = await withTenant(ctx, (tx) =>
    createConnection(tx, admin(ctx), {
      displayName: "Main EHR",
      baseUrl: FAKE_BASE_URL,
      clientId,
      mrnIdentifierSystem: "https://fhir.example.com/mrn",
    }),
  );
  return { id, clientId };
}

async function row(id: string) {
  const [connection] = await systemDb()
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id));
  return connection!;
}

async function audits(id: string) {
  return systemDb()
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.entityId, id))
    .orderBy(asc(auditEvents.id));
}

async function refusal(promise: Promise<unknown>): Promise<IntegrationConnectionError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IntegrationConnectionError) return error;
    throw error;
  }
  throw new Error("Expected an IntegrationConnectionError, but the call succeeded");
}

const META = `GET ${FAKE_BASE_URL}/metadata`;
const SMART = `GET ${FAKE_BASE_URL}/.well-known/smart-configuration`;
const TOKEN = `POST ${FAKE_TOKEN_ENDPOINT}`;

describe("testConnection — success", () => {
  it("passes, pins the discovered token endpoint and issuer on the draft, and audits configuration only", async () => {
    const { id, clientId } = await draft();
    const transport = FakeFhirTransport.healthy();
    const result = await testConnection(runner(a), admin(a), id, deps(transport));
    expect(result).toEqual({ outcome: "ok", message: outcomeMessage("ok") });

    const stored = await row(id);
    expect(stored).toMatchObject({
      status: "draft",
      tokenEndpoint: FAKE_TOKEN_ENDPOINT,
      tokenEndpointKey: FAKE_TOKEN_ENDPOINT,
      issuer: `${FAKE_BASE_URL} ${FAKE_BASE_URL}`,
      updatedBy: a.userId,
    });

    const events = await audits(id);
    const tested = events.filter((event) => event.action === "integration.connection_tested");
    expect(tested).toHaveLength(1);
    expect(tested[0]).toMatchObject({
      actorUserId: a.userId,
      tenantId: a.tenantId,
      entityType: "integration_connection",
      reason: "connection_test",
    });
    expect(tested[0]!.metadata).toEqual({
      outcome: "ok",
      sandbox: false,
      base_url: FAKE_BASE_URL,
      client_id: clientId,
      token_endpoint: FAKE_TOKEN_ENDPOINT,
      pinned: true,
    });
    // No security event for a clean run.
    expect(events.some((event) => event.action === "integration.transport_refused")).toBe(false);
  });

  it("requests no patient data: only metadata, smart-configuration, and the token endpoint", async () => {
    const { id } = await draft();
    const transport = FakeFhirTransport.healthy();
    await testConnection(runner(a), admin(a), id, deps(transport));
    expect(transport.requests.map((r) => `${r.method} ${r.url.origin}${r.url.pathname}`)).toEqual([
      META,
      SMART,
      TOKEN,
    ]);
    expect(transport.requests.some((r) => /Patient|Coverage|Organization/.test(r.url.pathname))).toBe(false);
  });

  it("signs the assertion with the shared key, for the pinned token endpoint and client ID", async () => {
    const { id, clientId } = await draft();
    const transport = FakeFhirTransport.healthy();
    await testConnection(runner(a), admin(a), id, deps(transport));
    const assertion = transport.postedForm().get("client_assertion")!;
    const [h, p, s] = assertion.split(".") as [string, string, string];
    const decode = (x: string) =>
      JSON.parse(Buffer.from(x, "base64url").toString("utf8")) as Record<string, unknown>;
    const [jwk] = await keyStore.publicJwks();
    expect(decode(h)).toEqual({ alg: "ES384", kid: jwk!.kid, typ: "JWT" });
    expect(decode(p)).toMatchObject({ iss: clientId, sub: clientId, aud: FAKE_TOKEN_ENDPOINT });
    expect(
      cryptoVerify(
        "sha384",
        Buffer.from(`${h}.${p}`),
        { key: createPublicKey({ key: jwk as never, format: "jwk" }), dsaEncoding: "ieee-p1363" },
        Buffer.from(s, "base64url"),
      ),
    ).toBe(true);
  });

  it("never lets the access token, the assertion, or a response body reach the audit log or the result", async () => {
    const { id } = await draft();
    const transport = FakeFhirTransport.healthy();
    const result = await testConnection(runner(a), admin(a), id, deps(transport));
    const assertion = transport.postedForm().get("client_assertion")!;
    const everything = JSON.stringify({
      result,
      audit: await audits(id),
      row: await row(id),
    });
    expect(everything).not.toContain(FAKE_ACCESS_TOKEN);
    expect(everything).not.toContain(assertion);
    expect(everything).not.toContain("Synthetic EHR"); // CapabilityStatement description
  });

  it("a repeat test that finds nothing new pins nothing and leaves updated_at alone", async () => {
    const { id } = await draft();
    await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
    const before = await row(id);
    await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
    const after = await row(id);
    expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    const tested = (await audits(id)).filter((event) => event.action === "integration.connection_tested");
    expect(tested.map((event) => event.metadata?.pinned)).toEqual([true, false]);
  });

  it("re-pins while still a draft when the server's token endpoint changes", async () => {
    const { id } = await draft();
    await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
    const moved = "https://auth2.example.com/oauth2/token";
    const transport = FakeFhirTransport.healthy()
      .set(SMART, jsonResponse(smartConfiguration({ token_endpoint: moved })))
      .set(
        `POST ${moved}`,
        jsonResponse({
          access_token: "t",
          token_type: "bearer",
          expires_in: 300,
          scope: "system/Patient.rs system/Coverage.rs system/Organization.rs",
        }),
      );
    expect((await testConnection(runner(a), admin(a), id, deps(transport))).outcome).toBe("ok");
    expect((await row(id)).tokenEndpoint).toBe(moved);
  });

  it("past draft, a changed token endpoint is refused, not adopted (pinned)", async () => {
    const { id } = await draft();
    await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
    await withTenant(a, (tx) =>
      tx
        .update(integrationConnections)
        .set({
          status: "pending_approval",
          submittedBy: a.userId,
          submittedAt: new Date(),
          usResidencyAttestedBy: a.userId,
          usResidencyAttestedAt: new Date(),
        })
        .where(eq(integrationConnections.id, id)),
    );
    const moved = "https://auth2.example.com/oauth2/token";
    const transport = FakeFhirTransport.healthy().set(
      SMART,
      jsonResponse(smartConfiguration({ token_endpoint: moved })),
    );
    const result = await testConnection(runner(a), admin(a), id, deps(transport));
    expect(result.outcome).toBe("smart_config_invalid");
    expect((await row(id)).tokenEndpoint).toBe(FAKE_TOKEN_ENDPOINT);
    expect(transport.requests.some((r) => r.method === "POST")).toBe(false); // no assertion sent to it
    const last = (await audits(id))
      .filter((event) => event.action === "integration.connection_tested")
      .at(-1)!;
    expect(last.metadata).toMatchObject({
      outcome: "smart_config_invalid",
      detail: "token_endpoint_changed",
      pinned: false,
    });
  });
});

describe("testConnection — failures", () => {
  it.each<[TransportErrorCode, string, boolean]>([
    ["tls_failed", "tls_failed", true],
    ["address_refused", "unreachable", true],
    ["redirect_refused", "unreachable", true],
    ["unreachable", "unreachable", false],
    ["timeout", "unreachable", false],
  ])("transport %s -> %s; security event: %s", async (code, outcome, security) => {
    const { id } = await draft();
    const transport = FakeFhirTransport.healthy().set(
      META,
      new TransportError(code, "https://fhir.example.com/r4/metadata?secret=1"),
    );
    const result = await testConnection(runner(a), admin(a), id, deps(transport));
    expect(result.outcome).toBe(outcome);
    expect(result.message).toBe(outcomeMessage(outcome as "unreachable"));
    // A failed test pins nothing.
    expect((await row(id)).tokenEndpoint).toBeNull();

    const events = await audits(id);
    const tested = events.find((event) => event.action === "integration.connection_tested")!;
    expect(tested.metadata).toMatchObject({ outcome, transport_code: code, pinned: false });
    const refused = events.filter((event) => event.action === "integration.transport_refused");
    if (!security) {
      expect(refused).toHaveLength(0);
      return;
    }
    expect(refused).toHaveLength(1);
    // ID only: the code, and nothing that names a URL, host, or path.
    expect(refused[0]!.metadata).toEqual({ code });
    expect(refused[0]).toMatchObject({ entityId: id, actorUserId: a.userId, tenantId: a.tenantId });
    expect(JSON.stringify(refused[0])).not.toMatch(/example\.com|secret|https?:/);
  });

  it.each([
    [
      "metadata isn't R4",
      META,
      jsonResponse(capabilityStatement({ fhirVersion: "4.0.0" }), "application/fhir+json"),
      "not_fhir_r4",
    ],
    [
      "no private_key_jwt",
      SMART,
      jsonResponse(smartConfiguration({ token_endpoint_auth_methods_supported: ["client_secret_basic"] })),
      "smart_config_invalid",
    ],
    [
      "the token endpoint refuses the client",
      TOKEN,
      { status: 401, contentType: "text/html", body: "" },
      "auth_refused",
    ],
  ] as const)("%s -> %s", async (_name, route, response, outcome) => {
    const { id } = await draft();
    const transport = FakeFhirTransport.healthy().set(route, response);
    expect((await testConnection(runner(a), admin(a), id, deps(transport))).outcome).toBe(outcome);
    expect((await row(id)).tokenEndpoint).toBeNull();
  });

  it("a server that only accepts RS384 cannot be used with the connection's ES384 key", async () => {
    const { id } = await draft();
    const transport = FakeFhirTransport.healthy().set(
      SMART,
      jsonResponse(smartConfiguration({ token_endpoint_auth_signing_alg_values_supported: ["RS384"] })),
    );
    expect((await testConnection(runner(a), admin(a), id, deps(transport))).outcome).toBe(
      "smart_config_invalid",
    );
    expect(transport.requests.some((r) => r.method === "POST")).toBe(false);
  });
});

describe("testConnection — refusals before any network call", () => {
  it("a non-administrator is refused and nothing is fetched or audited", async () => {
    const { id } = await draft();
    const transport = FakeFhirTransport.healthy();
    for (const role of ["manager", "specialist", "compliance"] as const) {
      const error = await refusal(testConnection(runner(a), { ...admin(a), role }, id, deps(transport)));
      expect(error.message).toMatch(/administrator/);
    }
    expect(transport.requests).toHaveLength(0);
    expect((await audits(id)).some((event) => event.action === "integration.connection_tested")).toBe(false);
  });

  it("another practice's connection is not found (tenant isolation)", async () => {
    const { id } = await draft(a);
    const transport = FakeFhirTransport.healthy();
    const error = await refusal(testConnection(runner(b), admin(b), id, deps(transport)));
    expect(error.message).toMatch(/not found/i);
    expect(transport.requests).toHaveLength(0);
  });

  it("an unknown id is not found", async () => {
    const error = await refusal(
      testConnection(runner(a), admin(a), randomUUID(), deps(FakeFhirTransport.healthy())),
    );
    expect(error.message).toMatch(/not found/i);
  });

  it("a revoked connection is refused", async () => {
    const { id } = await draft();
    const current = (await withTenant(a, (tx) => getConnection(tx, id)))!;
    await withTenant(a, (tx) => revokeConnection(tx, admin(a), id, current.updatedAt.toISOString()));
    const transport = FakeFhirTransport.healthy();
    const error = await refusal(testConnection(runner(a), admin(a), id, deps(transport)));
    expect(error.message).toMatch(/revoked/);
    expect(transport.requests).toHaveLength(0);
  });

  it("without INTEGRATION_SIGNING_KEY the test is a translated refusal, not a crash, and dials nothing", async () => {
    const { id } = await draft(a);
    const transport = FakeFhirTransport.healthy();
    const unconfigured = new EnvSharedKeyStore(() => true, "");
    const error = await refusal(testConnection(runner(a), admin(a), id, deps(transport, unconfigured)));
    expect(error.message).toMatch(/signing key isn't configured/);
    expect(transport.requests).toHaveLength(0);
    // ...and it doesn't spend the rate limit: five more tests with a key still pass.
    for (let i = 0; i < 5; i++) {
      await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
    }
  });

  it("an unreadable key, or a key store that can't be built here, is reported without detail", async () => {
    const { id } = await draft(a);
    const transport = FakeFhirTransport.healthy();
    const unreadable = new EnvSharedKeyStore(() => true, "not a pem");
    const error = await refusal(testConnection(runner(a), admin(a), id, deps(transport, unreadable)));
    expect(error.message).toMatch(/signing key isn't usable/);
    expect(error.message).not.toContain("pem");

    const broken = {
      transportFor: () => transport,
      keyStore: () => {
        throw new SigningKeyStoreError("env_key_in_production");
      },
    };
    const refused = await refusal(testConnection(runner(a), admin(a), id, broken));
    expect(refused.message).toMatch(/signing key isn't usable/);
    expect(transport.requests).toHaveLength(0);
  });

  it("the built-in sandbox has no transport yet: a translated refusal, nothing dialed or audited", async () => {
    const { id } = await draft(a);
    const error = await refusal(testConnection(runner(a), admin(a), id, deps(null)));
    expect(error.message).toMatch(/sandbox can't be tested yet/);
    expect((await audits(id)).some((event) => event.action === "integration.connection_tested")).toBe(false);
  });
});

describe("testConnection — rate limits (own buckets, per connection and per practice)", () => {
  it("allows 5 tests per connection in the window, then refuses the 6th without dialing out", async () => {
    const { id } = await draft();
    for (let i = 0; i < 5; i++) {
      await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
    }
    const transport = FakeFhirTransport.healthy();
    const error = await refusal(testConnection(runner(a), admin(a), id, deps(transport)));
    expect(error.message).toMatch(/Too many connection tests/);
    expect(transport.requests).toHaveLength(0);
    const limited = (await audits(id)).filter((event) => event.action === "security.rate_limited");
    expect(limited).toHaveLength(1);
    expect(limited[0]!.metadata).toEqual({ bucket: "integration_test_connection" });
  });

  it("limits a practice across its connections", async () => {
    const practice = await createTestTenant("Test connection practice limit");
    const connections = [];
    for (let i = 0; i < 6; i++) connections.push((await draft(practice)).id);
    // 5 connections x 4 tests = 20 (each under its own per-connection limit of 5).
    for (const id of connections.slice(0, 5)) {
      for (let i = 0; i < 4; i++) {
        await testConnection(runner(practice), admin(practice), id, deps(FakeFhirTransport.healthy()));
      }
    }
    const transport = FakeFhirTransport.healthy();
    const error = await refusal(
      testConnection(runner(practice), admin(practice), connections[5]!, deps(transport)),
    );
    expect(error.message).toMatch(/Too many connection tests/);
    expect(transport.requests).toHaveLength(0);
    const limited = (await audits(connections[5]!)).filter(
      (event) => event.action === "security.rate_limited",
    );
    expect(limited[0]!.metadata).toEqual({ bucket: "integration_test_practice" });
  });
});

describe("hasRecentPassingTest (what Submit will require)", () => {
  async function passedAt(id: string): Promise<Date> {
    const [event] = await systemDb()
      .select({ at: auditEvents.occurredAt })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, "integration.connection_tested")))
      .orderBy(asc(auditEvents.id))
      .limit(1);
    return event!.at;
  }
  const check = (ctx: Ctx, id: string, now?: Date) =>
    withTenant(ctx, (tx) => hasRecentPassingTest(tx, id, now));

  it("is false before any test and after a failing one", async () => {
    const { id } = await draft();
    expect(await check(a, id)).toBe(false);
    await testConnection(
      runner(a),
      admin(a),
      id,
      deps(FakeFhirTransport.healthy().set(META, new TransportError("unreachable"))),
    );
    expect(await check(a, id)).toBe(false);
  });

  it("is true after a passing test, with the 24 h boundary: 1 s inside, at, and 1 s after", async () => {
    const { id } = await draft();
    await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
    const at = await passedAt(id);
    expect(TEST_VALIDITY_MS).toBe(24 * 60 * 60 * 1000);
    expect(await check(a, id, new Date(at.getTime() + 60_000))).toBe(true);
    expect(await check(a, id, new Date(at.getTime() + TEST_VALIDITY_MS - 1000))).toBe(true);
    expect(await check(a, id, new Date(at.getTime() + TEST_VALIDITY_MS))).toBe(true);
    expect(await check(a, id, new Date(at.getTime() + TEST_VALIDITY_MS + 1000))).toBe(false);
  });

  it("stays true when a later test fails (the spec asks for a pass in the last 24 h)", async () => {
    const { id } = await draft();
    await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
    await testConnection(
      runner(a),
      admin(a),
      id,
      deps(FakeFhirTransport.healthy().set(TOKEN, { status: 401, contentType: undefined, body: "" })),
    );
    expect(await check(a, id)).toBe(true);
  });

  it("is invalidated by changing the client ID or the base URL, but not by renaming", async () => {
    const { id } = await draft();
    await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
    expect(await check(a, id)).toBe(true);

    const stamp = async () => (await withTenant(a, (tx) => getConnection(tx, id)))!.updatedAt.toISOString();
    const fields = (over: Record<string, string>) => ({
      displayName: "Main EHR",
      baseUrl: FAKE_BASE_URL,
      clientId: "",
      mrnIdentifierSystem: "https://fhir.example.com/mrn",
      ...over,
    });
    const current = (await row(id)).clientId;
    await withTenant(a, async (tx) =>
      updateConnection(
        tx,
        admin(a),
        id,
        await stamp(),
        fields({ clientId: current, displayName: "Renamed" }),
      ),
    );
    expect(await check(a, id)).toBe(true);

    await withTenant(a, async (tx) =>
      updateConnection(tx, admin(a), id, await stamp(), fields({ clientId: `${current}-new` })),
    );
    expect(await check(a, id)).toBe(false);
  });

  it("is per practice: another practice can't see it", async () => {
    const { id } = await draft(a);
    await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
    expect(await check(a, id)).toBe(true);
    expect(await check(b, id)).toBe(false);
  });
});
