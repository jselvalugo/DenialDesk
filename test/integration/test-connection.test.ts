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
  PASS_BINDING_METADATA_KEYS,
  TEST_VALIDITY_MS,
  testConnection,
  type TestConnectionDeps,
  type TxRunner,
} from "@/domain/integrations/test-connection";
import { TransportError, type TransportErrorCode } from "@/integrations/fhir/errors";
import { EnvSharedKeyStore, SigningKeyStoreError } from "@/integrations/fhir/keys";
import { VENDOR_SANDBOX_HOSTS } from "@/integrations/fhir/vendor-sandboxes";
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
      kid: (await keyStore.signer()).kid,
      token_endpoint: FAKE_TOKEN_ENDPOINT,
      token_endpoint_key: FAKE_TOKEN_ENDPOINT,
      issuer: `${FAKE_BASE_URL} ${FAKE_BASE_URL}`,
      pinned: true,
      // N3: what a pin replaced, so the audit log shows the change (nothing before the first pin).
      previous_token_endpoint: null,
      previous_issuer: null,
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

  it("sends the token request to the endpoint exactly as advertised, with that string as aud; the pin is normalized", async () => {
    const { id } = await draft();
    const advertised = "https://AUTH.example.com/oauth2/token/";
    const normalized = "https://auth.example.com/oauth2/token";
    const transport = FakeFhirTransport.healthy()
      .set(SMART, jsonResponse(smartConfiguration({ token_endpoint: advertised })))
      // The fake keys routes by origin + pathname, so the trailing slash is part of the route.
      .set(
        `POST ${normalized}/`,
        jsonResponse({
          access_token: "t",
          token_type: "bearer",
          expires_in: 300,
          scope: "system/Patient.rs system/Coverage.rs system/Organization.rs",
        }),
      );
    expect((await testConnection(runner(a), admin(a), id, deps(transport))).outcome).toBe("ok");
    const post = transport.requests.find((r) => r.method === "POST")!;
    expect(post.url.pathname).toBe("/oauth2/token/");
    const claims = JSON.parse(
      Buffer.from(transport.postedForm().get("client_assertion")!.split(".")[1]!, "base64url").toString(
        "utf8",
      ),
    ) as { aud: string };
    expect(claims.aud).toBe(advertised);
    expect(await row(id)).toMatchObject({
      tokenEndpoint: normalized,
      tokenEndpointKey: normalized.toLowerCase(),
    });
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
    const last = (await audits(id))
      .filter((event) => event.action === "integration.connection_tested")
      .at(-1)!;
    expect(last.metadata).toMatchObject({
      pinned: true,
      token_endpoint: moved,
      previous_token_endpoint: FAKE_TOKEN_ENDPOINT,
      previous_issuer: `${FAKE_BASE_URL} ${FAKE_BASE_URL}`,
    });
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

/** The Submit gate as a caller would run it: this practice's tenant, this connection, the key in use. */
async function check(ctx: Ctx, id: string, now?: Date, kid?: string, tenantId: string = ctx.tenantId) {
  const currentKid = kid ?? (await keyStore.signer()).kid;
  return withTenant(ctx, (tx) => hasRecentPassingTest(tx, tenantId, id, currentKid, now));
}

/** Moves a draft to pending_approval as the practice would at Submit (stand-in until Submit exists). */
async function moveToPending(ctx: Ctx, id: string) {
  await withTenant(ctx, (tx) =>
    tx
      .update(integrationConnections)
      .set({
        status: "pending_approval",
        submittedBy: ctx.userId,
        submittedAt: new Date(),
        usResidencyAttestedBy: ctx.userId,
        usResidencyAttestedAt: new Date(),
      })
      .where(eq(integrationConnections.id, id)),
  );
}

async function lastTested(id: string) {
  return (await audits(id)).filter((event) => event.action === "integration.connection_tested").at(-1)!;
}

describe("testConnection — the pins past draft (L1, L2, L3)", () => {
  it("L1: a missing token-endpoint pin past draft is a change, not a free pass (fails closed)", async () => {
    const { id } = await draft();
    await moveToPending(a, id); // never tested, so nothing was ever pinned
    const transport = FakeFhirTransport.healthy();
    const result = await testConnection(runner(a), admin(a), id, deps(transport));
    expect(result.outcome).toBe("smart_config_invalid");
    expect(transport.requests.some((r) => r.method === "POST")).toBe(false);
    expect((await row(id)).tokenEndpoint).toBeNull();
    expect((await lastTested(id)).metadata).toMatchObject({
      detail: "token_endpoint_changed",
      pinned: false,
    });
  });

  it("L3: a changed issuer past draft is refused too, and no assertion is sent", async () => {
    const { id } = await draft();
    await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
    await moveToPending(a, id);
    const transport = FakeFhirTransport.healthy().set(
      META,
      jsonResponse(
        capabilityStatement({ implementation: { url: "https://other.example.com/r4" } }),
        "application/fhir+json",
      ),
    );
    const result = await testConnection(runner(a), admin(a), id, deps(transport));
    expect(result.outcome).toBe("smart_config_invalid");
    expect(transport.requests.some((r) => r.method === "POST")).toBe(false);
    expect((await row(id)).issuer).toBe(`${FAKE_BASE_URL} ${FAKE_BASE_URL}`);
    expect((await lastTested(id)).metadata).toMatchObject({ detail: "issuer_changed", pinned: false });
  });

  it("L2: if the connection moves past draft while the test runs, the pass is recorded as a failure, for the endpoint actually tested", async () => {
    const { id } = await draft();
    const other = "https://other-auth.example.com/token";
    const transport = FakeFhirTransport.healthy().set(TOKEN, async () => {
      // Concurrent Submit: state moves on and (as a stand-in for a racing writer) a different pin lands.
      await systemDb()
        .update(integrationConnections)
        .set({
          status: "pending_approval",
          tokenEndpoint: other,
          tokenEndpointKey: other,
          issuer: "https://other.example.com/r4",
          submittedBy: a.userId,
          submittedAt: new Date(),
          usResidencyAttestedBy: a.userId,
          usResidencyAttestedAt: new Date(),
        })
        .where(eq(integrationConnections.id, id));
      return jsonResponse({
        access_token: FAKE_ACCESS_TOKEN,
        token_type: "bearer",
        expires_in: 300,
        scope: "system/Patient.rs system/Coverage.rs system/Organization.rs",
      });
    });
    const result = await testConnection(runner(a), admin(a), id, deps(transport));
    expect(result.outcome).toBe("smart_config_invalid");
    expect((await row(id)).tokenEndpoint).toBe(other); // untouched
    const metadata = (await lastTested(id)).metadata;
    // The status moved under the test, so what was tested is no longer what is there.
    expect(metadata).toMatchObject({
      outcome: "smart_config_invalid",
      detail: "config_changed",
      pinned: false,
    });
    // The endpoint that was actually tested, not the one the row holds now.
    expect(metadata?.token_endpoint).toBe(FAKE_TOKEN_ENDPOINT);
  });

  describe("a draft edited (through the domain) while the test runs", () => {
    const passingToken = () =>
      jsonResponse({
        access_token: FAKE_ACCESS_TOKEN,
        token_type: "bearer",
        expires_in: 300,
        scope: "system/Patient.rs system/Coverage.rs system/Organization.rs",
      });

    it.each([
      ["client ID", { clientId: "client-changed-midway" }],
      ["base URL", { baseUrl: "https://fhir2.example.com/r4" }],
    ])(
      "changing the %s mid-flight: nothing is pinned, the pass is not recorded, and the metadata names what was dialed",
      async (_name, over) => {
        const { id, clientId } = await draft();
        const transport = FakeFhirTransport.healthy().set(TOKEN, async () => {
          const stamp = (await withTenant(a, (tx) => getConnection(tx, id)))!.updatedAt.toISOString();
          await withTenant(a, (tx) =>
            updateConnection(tx, admin(a), id, stamp, {
              displayName: "Main EHR",
              baseUrl: FAKE_BASE_URL,
              clientId,
              mrnIdentifierSystem: "https://fhir.example.com/mrn",
              ...over,
            }),
          );
          return passingToken();
        });
        const result = await testConnection(runner(a), admin(a), id, deps(transport));
        expect(result.outcome).toBe("smart_config_invalid");
        // Nothing of the old server's endpoint or issuer was pinned onto the edited draft.
        expect(await row(id)).toMatchObject({ tokenEndpoint: null, tokenEndpointKey: null, issuer: null });
        const metadata = (await lastTested(id)).metadata;
        expect(metadata).toMatchObject({
          outcome: "smart_config_invalid",
          detail: "config_changed",
          pinned: false,
          // What was actually dialed, not the edited values now on the row.
          base_url: FAKE_BASE_URL,
          client_id: clientId,
        });
        expect(await check(a, id)).toBe(false);
      },
    );

    it("a direct client ID change (as a racing writer) is treated the same", async () => {
      const { id, clientId } = await draft();
      const transport = FakeFhirTransport.healthy().set(TOKEN, async () => {
        await systemDb()
          .update(integrationConnections)
          .set({ clientId: "client-changed-midway" })
          .where(eq(integrationConnections.id, id));
        return passingToken();
      });
      expect((await testConnection(runner(a), admin(a), id, deps(transport))).outcome).toBe(
        "smart_config_invalid",
      );
      expect((await row(id)).tokenEndpoint).toBeNull();
      expect((await lastTested(id)).metadata).toMatchObject({
        detail: "config_changed",
        client_id: clientId,
      });
      expect(await check(a, id)).toBe(false);
    });
  });
});

describe("testConnection — the environment rule before any network call (B2)", () => {
  const syntheticActor = (ctx: Ctx): IntegrationActor => ({ ...admin(ctx), syntheticOnly: true });

  it("refuses a real EHR host where only synthetic data is allowed: nothing dialed, no key consulted, nothing recorded as a test", async () => {
    const { id } = await draft(); // a draft that predates the rule, as if created elsewhere
    const transport = FakeFhirTransport.healthy();
    let transportAsked = false;
    let keyAsked = false;
    const error = await refusal(
      testConnection(runner(a), syntheticActor(a), id, {
        transportFor: () => {
          transportAsked = true;
          return transport;
        },
        keyStore: () => {
          keyAsked = true;
          return keyStore;
        },
        now: () => CLOCK,
      }),
    );
    expect(error.message).toMatch(/synthetic data only/);
    expect(transport.requests).toHaveLength(0);
    expect(transportAsked).toBe(false);
    expect(keyAsked).toBe(false);
    expect((await audits(id)).some((event) => event.action === "integration.connection_tested")).toBe(false);
  });

  it("allows only hosts in the reviewed vendor-sandbox constant, for the base URL and for the token endpoint", async () => {
    const original = [...VENDOR_SANDBOX_HOSTS];
    const mutable = VENDOR_SANDBOX_HOSTS as string[];
    try {
      // Base host reviewed, token host not: discovery runs, the assertion is never sent.
      mutable.push("fhir.example.com");
      const { id } = await draft();
      const blocked = FakeFhirTransport.healthy();
      const result = await testConnection(runner(a), syntheticActor(a), id, deps(blocked));
      expect(result.outcome).toBe("smart_config_invalid");
      expect(blocked.requests.map((r) => r.method)).toEqual(["GET", "GET"]);
      expect((await lastTested(id)).metadata).toMatchObject({
        detail: "token_host_not_permitted",
        pinned: false,
      });
      expect((await row(id)).tokenEndpoint).toBeNull();

      // Both reviewed: the test runs end to end.
      mutable.push("auth.example.com");
      const allowed = FakeFhirTransport.healthy();
      expect((await testConnection(runner(a), syntheticActor(a), id, deps(allowed))).outcome).toBe("ok");
      expect(allowed.requests.map((r) => r.method)).toEqual(["GET", "GET", "POST"]);
    } finally {
      mutable.length = 0;
      mutable.push(...original);
    }
  });

  it("does not restrict a production-shaped actor (real endpoints are allowed there, after operator approval)", async () => {
    const { id } = await draft();
    expect((await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()))).outcome).toBe(
      "ok",
    );
  });
});

describe("testConnection — every attempt is audited (N1) and misconfiguration is a security event (N2)", () => {
  it("N1: an unexpected error mid-attempt still writes a connection_tested row, then rethrows", async () => {
    const { id } = await draft();
    const transport = FakeFhirTransport.healthy();
    const exploding: EnvSharedKeyStore = Object.assign(Object.create(keyStore) as EnvSharedKeyStore, {
      signer: async () => ({
        alg: "ES384" as const,
        kid: "kid-boom",
        sign: async (): Promise<Buffer> => {
          throw new Error("vault exploded: SECRET-DETAIL");
        },
      }),
    });
    await expect(testConnection(runner(a), admin(a), id, deps(transport, exploding))).rejects.toThrow(
      /vault exploded/,
    );
    const tested = (await audits(id)).filter((event) => event.action === "integration.connection_tested");
    expect(tested).toHaveLength(1);
    expect(tested[0]!.metadata).toMatchObject({
      outcome: "unreachable",
      detail: "internal_error",
      pinned: false,
      kid: "kid-boom",
    });
    expect(JSON.stringify(tested[0])).not.toContain("SECRET-DETAIL");
    expect(await check(a, id, undefined, "kid-boom")).toBe(false);
  });

  it("a key store that fails while signing is the same translated refusal, with a connection_tested row", async () => {
    const { id } = await draft();
    const failing = Object.assign(Object.create(keyStore) as EnvSharedKeyStore, {
      signer: async () => ({
        alg: "ES384" as const,
        kid: "kid-vault",
        sign: async (): Promise<Buffer> => {
          throw new SigningKeyStoreError("key_unreadable");
        },
      }),
    });
    const error = await refusal(
      testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy(), failing)),
    );
    expect(error.message).toMatch(/signing key isn't usable/);
    const tested = (await audits(id)).filter((event) => event.action === "integration.connection_tested");
    expect(tested).toHaveLength(1);
    expect(tested[0]!.metadata).toMatchObject({
      outcome: "unreachable",
      detail: "internal_error",
      pinned: false,
    });
  });

  it("N2: an environment key found where real data is allowed is refused and audited as a security event", async () => {
    const { id } = await draft();
    const transport = FakeFhirTransport.healthy();
    const refused = await refusal(
      testConnection(runner(a), admin(a), id, {
        transportFor: () => transport,
        keyStore: () => {
          throw new SigningKeyStoreError("env_key_in_production");
        },
      }),
    );
    expect(refused.message).toMatch(/signing key isn't usable/);
    expect(transport.requests).toHaveLength(0);
    const events = (await audits(id)).filter(
      (event) => event.action === "security.env_signing_key_in_production",
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorUserId: a.userId, tenantId: a.tenantId, metadata: null });
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

  it("N4: the newest test must be the pass: any later failed test voids it, and a later pass restores it", async () => {
    const { id } = await draft();
    await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
    expect(await check(a, id)).toBe(true);
    await testConnection(
      runner(a),
      admin(a),
      id,
      deps(FakeFhirTransport.healthy().set(TOKEN, { status: 401, contentType: undefined, body: "" })),
    );
    expect(await check(a, id)).toBe(false);
    await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
    expect(await check(a, id)).toBe(true);
  });

  it("N4: a later refused address, TLS failure, or redirect voids the pass", async () => {
    for (const code of ["address_refused", "tls_failed", "redirect_refused"] as const) {
      const { id } = await draft();
      await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
      expect(await check(a, id)).toBe(true);
      await testConnection(
        runner(a),
        admin(a),
        id,
        deps(FakeFhirTransport.healthy().set(META, new TransportError(code))),
      );
      expect(await check(a, id)).toBe(false);
    }
  });

  it("N4: a bare integration.transport_refused event after the pass voids it, on its own", async () => {
    const { id } = await draft();
    await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
    expect(await check(a, id)).toBe(true);
    await systemDb()
      .insert(auditEvents)
      .values({
        action: "integration.transport_refused",
        tenantId: a.tenantId,
        actorUserId: a.userId,
        entityType: "integration_connection",
        entityId: id,
        metadata: { code: "address_refused" },
      });
    expect(await check(a, id)).toBe(false);
  });

  it("N4: the pass is tied to the key: a different kid (rotation, or a different key) voids it", async () => {
    const { id } = await draft();
    await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
    expect(await check(a, id)).toBe(true);
    expect(await check(a, id, undefined, "some-other-kid")).toBe(false);
    expect(await check(a, id, undefined, "")).toBe(false);
  });

  it("N4: the pass is tied to the token endpoint key and the issuer as well", async () => {
    for (const change of [
      { issuer: "https://x.example.com/r4" },
      { tokenEndpointKey: "https://x.example.com/t" },
    ]) {
      const { id } = await draft();
      await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
      expect(await check(a, id)).toBe(true);
      await systemDb().update(integrationConnections).set(change).where(eq(integrationConnections.id, id));
      expect(await check(a, id)).toBe(false);
    }
  });

  it("N4: pins the coupling: the recorded pass carries exactly the fields the gate compares", async () => {
    const { id, clientId } = await draft();
    await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
    const metadata = (await lastTested(id)).metadata!;
    expect(PASS_BINDING_METADATA_KEYS).toEqual([
      "base_url",
      "client_id",
      "token_endpoint",
      "token_endpoint_key",
      "issuer",
      "kid",
    ]);
    const stored = await row(id);
    expect(Object.fromEntries(PASS_BINDING_METADATA_KEYS.map((key) => [key, metadata[key]]))).toEqual({
      base_url: stored.baseUrl,
      client_id: clientId,
      token_endpoint: stored.tokenEndpoint,
      token_endpoint_key: stored.tokenEndpointKey,
      issuer: stored.issuer,
      kid: (await keyStore.signer()).kid,
    });
    // ...and the gate really reads each one: dropping any recorded field from the comparison
    // (simulated by a live value that differs) voids the pass.
    expect(await check(a, id)).toBe(true);
    await systemDb()
      .update(integrationConnections)
      .set({ baseUrl: `${stored.baseUrl}/x` })
      .where(eq(integrationConnections.id, id));
    expect(await check(a, id)).toBe(false);
  });

  describe("editing the endpoint of a tested draft starts over", () => {
    const fields = (over: Record<string, string>) => ({
      displayName: "Main EHR",
      baseUrl: FAKE_BASE_URL,
      clientId: "",
      mrnIdentifierSystem: "https://fhir.example.com/mrn",
      ...over,
    });

    /** A draft with a passing test (pins set) and a residency attestation on it. */
    async function testedAndAttested() {
      const { id, clientId } = await draft();
      await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
      await withTenant(a, (tx) =>
        tx
          .update(integrationConnections)
          .set({ usResidencyAttestedBy: a.userId, usResidencyAttestedAt: new Date() })
          .where(eq(integrationConnections.id, id)),
      );
      const before = await row(id);
      expect(before).toMatchObject({ tokenEndpoint: FAKE_TOKEN_ENDPOINT, usResidencyAttestedBy: a.userId });
      expect(before.tokenEndpointKey).not.toBeNull();
      expect(before.issuer).not.toBeNull();
      return { id, clientId };
    }

    const edit = async (id: string, over: Record<string, string>) => {
      const stamp = (await withTenant(a, (tx) => getConnection(tx, id)))!.updatedAt.toISOString();
      await withTenant(a, (tx) => updateConnection(tx, admin(a), id, stamp, fields(over)));
    };

    it.each([
      ["client ID", (clientId: string) => ({ clientId: `${clientId}-new` })],
      ["base URL", (clientId: string) => ({ clientId, baseUrl: "https://fhir2.example.com/r4" })],
    ])(
      "changing the %s clears the pinned token endpoint, its key, the issuer, and the attestation",
      async (_name, change) => {
        const { id, clientId } = await testedAndAttested();
        await edit(id, change(clientId));
        expect(await row(id)).toMatchObject({
          tokenEndpoint: null,
          tokenEndpointKey: null,
          issuer: null,
          usResidencyAttestedBy: null,
          usResidencyAttestedAt: null,
        });
        expect(await check(a, id)).toBe(false);
        const event = (await audits(id)).filter((e) => e.action === "integration.connection_updated").at(-1)!;
        expect(event.metadata).toMatchObject({ discovery_cleared: true });
      },
    );

    it("a test after the edit pins the new endpoint again", async () => {
      const { id, clientId } = await testedAndAttested();
      await edit(id, { clientId: `${clientId}-new` });
      expect((await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()))).outcome).toBe(
        "ok",
      );
      expect((await row(id)).tokenEndpoint).toBe(FAKE_TOKEN_ENDPOINT);
      expect(await check(a, id)).toBe(true);
    });

    it("renaming, or changing only the MRN identifier system, keeps the pins and the attestation", async () => {
      const { id, clientId } = await testedAndAttested();
      await edit(id, { clientId, displayName: "Renamed" });
      await edit(id, { clientId, mrnIdentifierSystem: "https://fhir.example.com/mrn2" });
      expect(await row(id)).toMatchObject({
        tokenEndpoint: FAKE_TOKEN_ENDPOINT,
        usResidencyAttestedBy: a.userId,
      });
      const event = (await audits(id)).filter((e) => e.action === "integration.connection_updated").at(-1)!;
      expect(event.metadata).not.toHaveProperty("discovery_cleared");
    });
  });

  it("N4: the tenant is checked explicitly as well as by row-level security", async () => {
    const { id } = await draft(a);
    await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
    // Practice A's own session, but asking as practice B: RLS would let A's rows through; the guard doesn't.
    expect(await check(a, id, undefined, undefined, b.tenantId)).toBe(false);
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

  it("is per practice: another practice can't see it, and can't read the audit rows it rests on", async () => {
    const { id } = await draft(a);
    await testConnection(runner(a), admin(a), id, deps(FakeFhirTransport.healthy()));
    expect(await check(a, id)).toBe(true);
    expect(await check(b, id)).toBe(false);
    // Straight at audit_events as practice B's session: row-level security (audit_read) must hide
    // practice A's rows, so a broken audit policy fails here and not only through the gate.
    const asB = await withTenant(b, (tx) =>
      tx.select({ id: auditEvents.id }).from(auditEvents).where(eq(auditEvents.entityId, id)),
    );
    expect(asB).toEqual([]);
    const asA = await withTenant(a, (tx) =>
      tx.select({ id: auditEvents.id }).from(auditEvents).where(eq(auditEvents.entityId, id)),
    );
    expect(asA.length).toBeGreaterThan(0);
  });
});
