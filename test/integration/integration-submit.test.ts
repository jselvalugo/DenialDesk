import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, integrationConnections, integrationEndpointRegistry } from "@/db/schema";
import { withTenant, withTenantAsPlatform } from "@/db/tenant";
import {
  createConnection,
  createSandboxConnection,
  getConnection,
  IntegrationConnectionError,
  resolveSigningKid,
  resumeConnection,
  revokeConnection,
  submitBlockedReason,
  submitConnection,
  updateConnection,
  US_RESIDENCY_ATTESTATION_VERSION,
  withdrawConnection,
  type ConnectionStatus,
  type IntegrationActor,
  type SigningDeps,
  type SubmitInput,
} from "@/domain/integrations/connections";
import {
  TEST_VALIDITY_MS,
  testConnection,
  type TestConnectionDeps,
  type TxRunner,
} from "@/domain/integrations/test-connection";
import { en } from "@/i18n/messages/en";
import { es } from "@/i18n/messages/es";
import { pt } from "@/i18n/messages/pt";
import { EnvSharedKeyStore, SigningKeyStoreError } from "@/integrations/fhir/keys";
import { log } from "@/lib/log";
import { SANDBOX_BASE_URL, SANDBOX_CLIENT_ID } from "@/integrations/fhir/url-rules";
import { FAKE_BASE_URL, FAKE_TOKEN_ENDPOINT, FakeFhirTransport } from "../support/fake-fhir-transport";
import { createTestTenant } from "./helpers";

// docs/specs/patient-integrations.md PI2a: Submit (step-up, a passing Test connection, the U.S.-residency
// attestation, both stamps in the one UPDATE that changes status, the registry claim) and Resume from
// `error` requiring a passing test. R-7.2.2, R-7.2.4, R-7.5.1, R-3.3.1.
//
// The connections here point at the fake server's base URL and are tested for real through
// `testConnection` with `FakeFhirTransport`, so the pass Submit looks for is the one the application
// writes. Keys come from the environment adapter over a key generated here (as in
// test-connection.test.ts): nothing is written to `key_ref`.

type Ctx = { tenantId: string; userId: string };
let a: Ctx;
let b: Ctx;

const signingKey = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey;
const keyStore = new EnvSharedKeyStore(
  () => true,
  signingKey.export({ format: "pem", type: "pkcs8" }).toString(),
);
const otherKeyStore = new EnvSharedKeyStore(
  () => true,
  generateKeyPairSync("ec", { namedCurve: "secp384r1" })
    .privateKey.export({ format: "pem", type: "pkcs8" })
    .toString(),
);
const signing: SigningDeps = { keyStore: () => keyStore };

const VERIFIED_AT = new Date(Date.now() - 60_000).toISOString();

/** Production-shaped admin (real endpoints allowed) unless `synthetic`; a recent step-up unless `mfa: false`. */
const admin = (ctx: Ctx, options: { synthetic?: boolean; mfa?: boolean } = {}): IntegrationActor => ({
  ...ctx,
  role: "admin",
  syntheticOnly: options.synthetic ?? false,
  recentMfa: options.mfa ?? true,
  stepUpVerifiedAt: options.mfa === false ? null : VERIFIED_AT,
});
const runner =
  (ctx: Ctx): TxRunner =>
  (fn) =>
    withTenant(ctx, fn);

function testDeps(transport: FakeFhirTransport, store = keyStore): TestConnectionDeps {
  return { transportFor: () => transport, keyStore: () => store };
}

const TOKEN = `POST ${FAKE_TOKEN_ENDPOINT}`;
const failingToken = () =>
  FakeFhirTransport.healthy().set(TOKEN, { status: 401, contentType: undefined, body: "" });

// "Test connection" is rate-limited per practice, so every test gets fresh practices.
beforeEach(async () => {
  a = await createTestTenant("Submit A");
  b = await createTestTenant("Submit B");
});
afterAll(() => closeDatabase());

async function refusal(promise: Promise<unknown>): Promise<IntegrationConnectionError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IntegrationConnectionError) return error;
    throw error;
  }
  throw new Error("Expected an IntegrationConnectionError, but the call succeeded");
}

/** A draft against the fake server's base URL. */
async function draft(ctx: Ctx = a, clientId = `client-${randomUUID().slice(0, 8)}`) {
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

/** Test connection against a healthy fake server (records the pass, pins the token endpoint and issuer). */
async function passTest(ctx: Ctx, id: string, transport = FakeFhirTransport.healthy()) {
  const result = await testConnection(runner(ctx), admin(ctx), id, testDeps(transport));
  expect(result.outcome).toBe("ok");
}

const stamp = async (ctx: Ctx, id: string) =>
  (await withTenant(ctx, (tx) => getConnection(tx, id)))!.updatedAt.toISOString();

const DEFAULT_INPUT: SubmitInput = { attested: true, locale: "en" };

async function submit(
  ctx: Ctx,
  id: string,
  options: { mfa?: boolean; input?: Partial<SubmitInput>; synthetic?: boolean; deps?: SigningDeps } = {},
  opened?: string,
) {
  return submitConnection(
    runner(ctx),
    admin(ctx, { mfa: options.mfa, synthetic: options.synthetic }),
    id,
    opened ?? (await stamp(ctx, id)),
    { ...DEFAULT_INPUT, ...options.input },
    options.deps ?? signing,
  );
}

async function row(id: string) {
  const [connection] = await systemDb()
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id));
  return connection!;
}

async function registryRows(id: string) {
  return systemDb()
    .select()
    .from(integrationEndpointRegistry)
    .where(eq(integrationEndpointRegistry.connectionId, id));
}

async function audits(id: string, action?: string) {
  const rows = await systemDb()
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.entityId, id))
    .orderBy(asc(auditEvents.id));
  return action ? rows.filter((event) => event.action === action) : rows;
}

/** Nothing was written for a refused Submit: still a draft, no stamps, no registry entry, no audit row for it. */
async function expectUntouchedDraft(id: string) {
  expect(await row(id)).toMatchObject({
    status: "draft",
    submittedBy: null,
    submittedAt: null,
    usResidencyAttestedBy: null,
    usResidencyAttestedAt: null,
  });
  expect(await registryRows(id)).toEqual([]);
  expect(await audits(id, "integration.connection_submitted")).toEqual([]);
}

/** The operator's approval (PI1c has not shipped): table-owner privileges, as in the lifecycle tests. */
async function approve(ctx: Ctx, id: string) {
  await withTenantAsPlatform(ctx, (tx) =>
    tx.execute(sql`
      update integration_connections
      set status = 'active', approved_by = ${ctx.userId}::uuid, approved_at = now(),
          approval_method = 'phone_verified', population_scope = 'verified_filter'
      where id = ${id}::uuid
    `),
  );
}

/** A status change made the way the system does (the app role's UPDATE grant). */
async function setStatus(ctx: Ctx, id: string, status: ConnectionStatus, reason: string | null = null) {
  await withTenant(ctx, (tx) =>
    tx.execute(sql`
      update integration_connections set status = ${status}::integration_connection_status,
        status_reason = ${reason}, updated_at = now()
      where id = ${id}::uuid
    `),
  );
}

describe("submitConnection — a real connection", () => {
  it("moves a tested draft to pending_approval, stamping both columns in one UPDATE, and claims the registry", async () => {
    const { id, clientId } = await draft();
    await passTest(a, id);
    const result = await submit(a, id);
    expect(result).toEqual({ status: "pending_approval" });

    const stored = await row(id);
    expect(stored).toMatchObject({
      status: "pending_approval",
      submittedBy: a.userId,
      usResidencyAttestedBy: a.userId,
      updatedBy: a.userId,
    });
    // One statement: both stamps come from the same transaction clock.
    expect(stored.submittedAt).not.toBeNull();
    expect(stored.usResidencyAttestedAt!.toISOString()).toBe(stored.submittedAt!.toISOString());

    const [claim] = await registryRows(id);
    expect(claim).toMatchObject({
      connectionId: id,
      endpointKey: FAKE_BASE_URL,
      clientId,
      tokenEndpointKey: FAKE_TOKEN_ENDPOINT,
    });
  });

  it("audits configuration only: who, from what, the attestation's version and language, the test's key", async () => {
    const { id, clientId } = await draft();
    await passTest(a, id);
    await submit(a, id, { input: { locale: "es" } });
    const events = await audits(id, "integration.connection_submitted");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: a.userId,
      tenantId: a.tenantId,
      entityType: "integration_connection",
      reason: "connection_submit",
    });
    expect(events[0]!.metadata).toMatchObject({
      previous_status: "draft",
      status: "pending_approval",
      sandbox: false,
      step_up_verified_at: VERIFIED_AT,
      test_kid: await keyStore.kid(),
      base_url: FAKE_BASE_URL,
      client_id: clientId,
      mrn_identifier_system: "https://fhir.example.com/mrn",
      token_endpoint: FAKE_TOKEN_ENDPOINT,
      registry_claimed: true,
      us_residency_attested: true,
      attestation_version: US_RESIDENCY_ATTESTATION_VERSION,
      // The displayed language, and a hash of the exact text shown in it.
      attestation_locale: "es",
      attestation_text_sha256: createHash("sha256")
        .update(es.integrations["submit.attestation"])
        .digest("hex"),
    });
    // Nothing from the fake server's responses, and no other practice, is in the record.
    expect(JSON.stringify(events[0]!.metadata)).not.toContain(b.tenantId);
  });

  it("clears a leftover status reason in the same UPDATE", async () => {
    const { id } = await draft();
    await passTest(a, id);
    await systemDb()
      .update(integrationConnections)
      .set({ statusReason: "auth_failed" })
      .where(eq(integrationConnections.id, id));
    await submit(a, id);
    expect(await row(id)).toMatchObject({ status: "pending_approval", statusReason: null });
  });

  it("records the hash of the text shown in the displayed language, and refuses a language the app doesn't have", async () => {
    const { id } = await draft();
    await passTest(a, id);
    const error = await refusal(submit(a, id, { input: { locale: "fr" as never } }));
    expect(error.message).toMatch(/page language changed/);
    await expectUntouchedDraft(id);
    await submit(a, id, { input: { locale: "pt" } });
    expect((await audits(id, "integration.connection_submitted"))[0]!.metadata).toMatchObject({
      attestation_locale: "pt",
      attestation_text_sha256: createHash("sha256")
        .update(pt.integrations["submit.attestation"])
        .digest("hex"),
    });
  });

  it("is refused without a passing Test connection, writing and auditing nothing", async () => {
    const { id } = await draft();
    const error = await refusal(submit(a, id));
    expect(error.message).toMatch(/Test connection has to pass first/);
    expect(error.stepUpRequired).toBe(false);
    await expectUntouchedDraft(id);
  });

  it("is refused when the newest test failed, even after an earlier pass", async () => {
    const { id } = await draft();
    await passTest(a, id);
    const failed = await testConnection(runner(a), admin(a), id, testDeps(failingToken()));
    expect(failed.outcome).toBe("auth_refused");
    const error = await refusal(submit(a, id));
    expect(error.message).toMatch(/Test connection has to pass first/);
    await expectUntouchedDraft(id);
    // ...and a new pass restores it.
    await passTest(a, id);
    expect((await submit(a, id)).status).toBe("pending_approval");
  });

  it("is refused when the pass was for another signing key (rotation voids it)", async () => {
    const { id } = await draft();
    await passTest(a, id);
    const error = await refusal(submit(a, id, { deps: { keyStore: () => otherKeyStore } }));
    expect(error.message).toMatch(/Test connection has to pass first/);
    await expectUntouchedDraft(id);
  });

  it("is refused when the connection was edited after the pass", async () => {
    const { id } = await draft();
    await passTest(a, id);
    await systemDb()
      .update(integrationConnections)
      .set({ issuer: "https://elsewhere.example.com/r4" })
      .where(eq(integrationConnections.id, id));
    const error = await refusal(submit(a, id));
    expect(error.message).toMatch(/Test connection has to pass first/);
    await expectUntouchedDraft(id);
  });

  it("is refused without a recent step-up, flagged so the page can offer it", async () => {
    const { id } = await draft();
    await passTest(a, id);
    const error = await refusal(submit(a, id, { mfa: false }));
    expect(error.stepUpRequired).toBe(true);
    expect(error.message).toMatch(/two-step verification/);
    await expectUntouchedDraft(id);
  });

  it("is refused without the residency attestation, pointing at the checkbox", async () => {
    const { id } = await draft();
    await passTest(a, id);
    for (const attested of [false, undefined as never, "on" as never, 1 as never]) {
      const error = await refusal(submit(a, id, { input: { attested } }));
      expect(error.field).toBe("attestation");
      expect(error.message).toMatch(/only in the United States/);
    }
    await expectUntouchedDraft(id);
  });

  it("is refused with no usable signing key, saying so without key detail", async () => {
    const { id } = await draft();
    await passTest(a, id);
    const error = await refusal(
      submit(a, id, { deps: { keyStore: () => new EnvSharedKeyStore(() => true, "") } }),
    );
    expect(error.message).toMatch(/signing key isn't configured/);
    await expectUntouchedDraft(id);
  });

  it("is refused in the wrong status: a second Submit, a revoked connection", async () => {
    const { id } = await draft();
    await passTest(a, id);
    await submit(a, id);
    const again = await refusal(submit(a, id));
    expect(again.message).toMatch(/isn't in a state where that is possible/);
    expect((await row(id)).status).toBe("pending_approval");
    expect(await audits(id, "integration.connection_submitted")).toHaveLength(1);

    const gone = await draft();
    await passTest(a, gone.id);
    await withTenant(a, async (tx) =>
      revokeConnection(tx, admin(a), gone.id, await stamp(a, gone.id), "other"),
    );
    const revoked = await refusal(submit(a, gone.id));
    expect(revoked.message).toMatch(/revoked/);
    expect((await row(gone.id)).status).toBe("revoked");
  });

  it("is refused for anyone but an administrator", async () => {
    const { id } = await draft();
    await passTest(a, id);
    const error = await refusal(
      submitConnection(
        runner(a),
        { ...admin(a), role: "manager" },
        id,
        await stamp(a, id),
        DEFAULT_INPUT,
        signing,
      ),
    );
    expect(error.message).toMatch(/administrator/);
    await expectUntouchedDraft(id);
  });

  it("is not found across practices, even with a passing test and a step-up of their own", async () => {
    const { id } = await draft(a);
    await passTest(a, id);
    const opened = await stamp(a, id);
    const before = (await audits(id)).length;
    const error = await refusal(submit(b, id, {}, opened));
    expect(error.message).toMatch(/not found/);
    expect(error.stepUpRequired).toBe(false);
    await expectUntouchedDraft(id);
    expect((await audits(id)).length).toBe(before);
  });

  it("is refused on a stale page", async () => {
    const { id, clientId } = await draft();
    await passTest(a, id);
    const opened = await stamp(a, id);
    await withTenant(a, (tx) =>
      updateConnection(tx, admin(a), id, opened, {
        displayName: "Renamed since the page opened",
        baseUrl: FAKE_BASE_URL,
        clientId,
        mrnIdentifierSystem: "https://fhir.example.com/mrn",
      }),
    );
    const error = await refusal(submit(a, id, {}, opened));
    expect(error.message).toMatch(/changed since you opened it/);
    await expectUntouchedDraft(id);
  });

  it("applies the environment rule: a real connection is refused where only synthetic data is allowed", async () => {
    const { id } = await draft();
    await passTest(a, id);
    const error = await refusal(submit(a, id, { synthetic: true }));
    expect(error.message).toMatch(/synthetic data only/);
    await expectUntouchedDraft(id);
  });

  it("locks the row: two Submits at once, exactly one wins", async () => {
    const { id } = await draft();
    await passTest(a, id);
    const opened = await stamp(a, id);
    const outcomes = await Promise.allSettled([submit(a, id, {}, opened), submit(a, id, {}, opened)]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(IntegrationConnectionError);
    expect((await audits(id, "integration.connection_submitted")).length).toBe(1);
    expect((await registryRows(id)).length).toBe(1);
  });
});

describe("submitConnection — the endpoint registry", () => {
  it("refuses a second practice with the same endpoint and client ID, naming no one, and audits the conflict", async () => {
    const clientId = `shared-client-${randomUUID().slice(0, 8)}`;
    const first = await draft(a, clientId);
    await passTest(a, first.id);
    await submit(a, first.id);

    const second = await draft(b, clientId);
    await passTest(b, second.id);
    const error = await refusal(submit(b, second.id));
    expect(error.message).toBe("This endpoint and client ID are already connected");
    expect(error.field).toBeUndefined();
    expect(error.stepUpRequired).toBe(false);
    // Nothing that identifies the other practice reaches the message.
    expect(error.message).not.toContain(a.tenantId);

    // Rolled back: still a draft, no stamps, no claim; the first practice's claim is untouched.
    await expectUntouchedDraft(second.id);
    expect(await registryRows(second.id)).toEqual([]);
    expect((await registryRows(first.id))[0]).toMatchObject({ connectionId: first.id, clientId });
    expect((await row(first.id)).status).toBe("pending_approval");

    // Audited against the practice that tried: configuration only, no other practice.
    const conflicts = await audits(second.id, "integration.registry_conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      actorUserId: b.userId,
      tenantId: b.tenantId,
      entityType: "integration_connection",
      reason: "connection_submit",
    });
    expect(conflicts[0]!.metadata).toEqual({
      sandbox: false,
      base_url: FAKE_BASE_URL,
      client_id: clientId,
      mrn_identifier_system: "https://fhir.example.com/mrn",
    });
    expect(JSON.stringify(conflicts[0])).not.toContain(a.tenantId);
    expect(await audits(first.id, "integration.registry_conflict")).toEqual([]);
  });

  it("still shows the conflict message when the conflict's own audit transaction fails, and logs IDs only", async () => {
    const clientId = `shared-client-${randomUUID().slice(0, 8)}`;
    const first = await draft(a, clientId);
    await passTest(a, first.id);
    await submit(a, first.id);
    const second = await draft(b, clientId);
    await passTest(b, second.id);

    // The first transaction (the Submit itself) is real and is rolled back by the conflict; the second
    // one, which writes `integration.registry_conflict`, fails in the database.
    let transactions = 0;
    const failingSecond: TxRunner = (fn) => {
      transactions += 1;
      return transactions === 1
        ? withTenant(b, fn)
        : withTenant(b, async (tx) => {
            await tx.execute(sql`select 1 / 0`);
            return undefined as never;
          });
    };
    const logged = vi.spyOn(log, "error").mockImplementation(() => undefined);
    try {
      const error = await refusal(
        submitConnection(
          failingSecond,
          admin(b),
          second.id,
          await stamp(b, second.id),
          DEFAULT_INPUT,
          signing,
        ),
      );
      // The administrator sees the conflict, not a database error, and nothing names the other practice.
      expect(error.message).toBe("This endpoint and client ID are already connected");
      expect(transactions).toBe(2);
      // The failure is logged with IDs only: no configuration, no SQL text, no error detail.
      // Two lines, both codes/IDs only: the database layer's own sanitized "db.query_failed" (SQLSTATE
      // 22012, division by zero) and the conflict-audit failure.
      expect(logged.mock.calls).toEqual([
        ["db.query_failed", { status: "22012" }],
        ["integration.registry_conflict_audit_failed", { tenantId: b.tenantId, connectionId: second.id }],
      ]);
    } finally {
      logged.mockRestore();
    }
    // The submission was rolled back and no conflict event exists (that is the failure being tested).
    await expectUntouchedDraft(second.id);
    expect(await audits(second.id, "integration.registry_conflict")).toEqual([]);
    expect((await registryRows(first.id))[0]).toMatchObject({ connectionId: first.id, clientId });
  });

  it("frees the endpoint once the first practice withdraws, so the second can submit", async () => {
    const clientId = `shared-client-${randomUUID().slice(0, 8)}`;
    const first = await draft(a, clientId);
    await passTest(a, first.id);
    await submit(a, first.id);
    const second = await draft(b, clientId);
    await passTest(b, second.id);
    await refusal(submit(b, second.id));

    await withTenant(a, async (tx) => withdrawConnection(tx, admin(a), first.id, await stamp(a, first.id)));
    expect((await submit(b, second.id)).status).toBe("pending_approval");
    expect((await registryRows(second.id))[0]).toMatchObject({ connectionId: second.id, clientId });
  });

  it("does not conflict for the same endpoint under another client ID", async () => {
    const first = await draft(a);
    await passTest(a, first.id);
    await submit(a, first.id);
    const second = await draft(b);
    await passTest(b, second.id);
    expect((await submit(b, second.id)).status).toBe("pending_approval");
  });
});

describe("submitConnection — two practices at once", () => {
  it("of two practices submitting the same endpoint and client ID at the same time, exactly one claims", async () => {
    const clientId = `race-client-${randomUUID().slice(0, 8)}`;
    const first = await draft(a, clientId);
    const second = await draft(b, clientId);
    await passTest(a, first.id);
    await passTest(b, second.id);
    const outcomes = await Promise.allSettled([submit(a, first.id), submit(b, second.id)]);
    const won = outcomes.filter((o) => o.status === "fulfilled");
    const lost = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0]!.reason).toBeInstanceOf(IntegrationConnectionError);
    expect(lost[0]!.reason.message).toBe("This endpoint and client ID are already connected");

    const claims = [...(await registryRows(first.id)), ...(await registryRows(second.id))];
    expect(claims).toHaveLength(1);
    // The loser is a draft again, with its conflict on record; the winner is pending.
    const statuses = [(await row(first.id)).status, (await row(second.id)).status].sort();
    expect(statuses).toEqual(["draft", "pending_approval"]);
    const conflicts = [
      ...(await audits(first.id, "integration.registry_conflict")),
      ...(await audits(second.id, "integration.registry_conflict")),
    ];
    expect(conflicts).toHaveLength(1);
  });
});

describe("submitConnection — one connection outside draft/revoked per practice", () => {
  const anotherLive = /Another connection is already in use/;

  it("refuses in words, not a save error, while another connection is submitted, and touches nothing", async () => {
    const first = await draft();
    await passTest(a, first.id);
    await submit(a, first.id);

    const second = await draft();
    await passTest(a, second.id);
    const error = await refusal(submit(a, second.id));
    expect(error.message).toMatch(anotherLive);
    expect(error.stepUpRequired).toBe(false);
    await expectUntouchedDraft(second.id);
    expect(await audits(second.id, "integration.registry_conflict")).toEqual([]);
    expect((await row(first.id)).status).toBe("pending_approval");
  });

  it("refuses while the other connection is active, too", async () => {
    const first = await draft();
    await passTest(a, first.id);
    await submit(a, first.id);
    await approve(a, first.id);
    const second = await draft();
    await passTest(a, second.id);
    expect((await refusal(submit(a, second.id))).message).toMatch(anotherLive);
    await expectUntouchedDraft(second.id);
  });

  it("allows it once the other is withdrawn back to a draft or revoked", async () => {
    const first = await draft();
    await passTest(a, first.id);
    await submit(a, first.id);
    const second = await draft();
    await passTest(a, second.id);
    await refusal(submit(a, second.id));

    await withTenant(a, async (tx) => withdrawConnection(tx, admin(a), first.id, await stamp(a, first.id)));
    expect((await submit(a, second.id)).status).toBe("pending_approval");

    const third = await draft();
    await passTest(a, third.id);
    expect((await refusal(submit(a, third.id))).message).toMatch(anotherLive);
    await withTenant(a, async (tx) =>
      revokeConnection(tx, admin(a), second.id, await stamp(a, second.id), "other"),
    );
    expect((await submit(a, third.id)).status).toBe("pending_approval");
  });

  it("is per practice: another practice's live connection doesn't block", async () => {
    const other = await draft(b);
    await passTest(b, other.id);
    await submit(b, other.id);
    const mine = await draft(a);
    await passTest(a, mine.id);
    expect((await submit(a, mine.id)).status).toBe("pending_approval");
  });

  it("two drafts of one practice submitted at once: one wins, the other is refused in the same words", async () => {
    const first = await draft();
    const second = await draft();
    await passTest(a, first.id);
    await passTest(a, second.id);
    const outcomes = await Promise.allSettled([submit(a, first.id), submit(a, second.id)]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const lost = outcomes.find((o): o is PromiseRejectedResult => o.status === "rejected")!;
    // Whether the loser was refused by the check or by the unique index it races into, it is this refusal.
    expect(lost.reason).toBeInstanceOf(IntegrationConnectionError);
    expect(lost.reason.message).toMatch(anotherLive);
    const statuses = [(await row(first.id)).status, (await row(second.id)).status].sort();
    expect(statuses).toEqual(["draft", "pending_approval"]);
  });
});

describe("submitConnection — the test's age, the rate limit, and the panel's reason", () => {
  it("is refused when the pass is more than 24 h old by the injected clock, and allowed just inside", async () => {
    const { id } = await draft();
    await passTest(a, id);
    const [passed] = (await audits(id, "integration.connection_tested")).slice(-1);
    const later = (ms: number): SigningDeps => ({
      keyStore: () => keyStore,
      now: () => new Date(passed!.occurredAt.getTime() + ms),
    });
    const error = await refusal(submit(a, id, { deps: later(TEST_VALIDITY_MS + 1000) }));
    expect(error.message).toMatch(/Test connection has to pass first/);
    await expectUntouchedDraft(id);
    expect((await submit(a, id, { deps: later(TEST_VALIDITY_MS - 1000) })).status).toBe("pending_approval");
  });

  it("limits Submit attempts per practice, audits the refusal, and leaves other practices alone", async () => {
    const { id } = await draft();
    // A pinned clock keeps every attempt in one rate-limit window. Ten attempts are allowed (each is
    // refused for the missing test), the eleventh is rate limited.
    const clock = new Date();
    const pinned: SigningDeps = { keyStore: () => keyStore, now: () => clock };
    for (let attempt = 1; attempt <= 10; attempt++) {
      const error = await refusal(submit(a, id, { deps: pinned }));
      expect(error.message, `attempt ${attempt}`).toMatch(/Test connection has to pass first/);
    }
    const limited = await refusal(submit(a, id, { deps: pinned }));
    expect(limited.message).toMatch(/Too many submit attempts/);
    await expectUntouchedDraft(id);
    const [event] = await audits(id, "security.rate_limited");
    expect(event).toMatchObject({
      actorUserId: a.userId,
      tenantId: a.tenantId,
      entityType: "integration_connection",
      reason: "connection_submit",
      metadata: { bucket: "integration_submit" },
    });

    const other = await draft(b);
    const stillAllowed = await refusal(submit(b, other.id, { deps: pinned }));
    expect(stillAllowed.message).toMatch(/Test connection has to pass first/);
  });

  it("explains, in order, why the panel's button is disabled: environment, another connection, no test", async () => {
    const { id } = await draft();
    const info = { id, targetTable: "patients", isSandbox: false };
    const reason = async (actor: IntegrationActor, connection = info) =>
      withTenant(a, async (tx) =>
        submitBlockedReason(tx, actor, connection, await resolveSigningKid(signing, connection.id)),
      );

    expect(await reason(admin(a, { synthetic: true }))).toBe("error.realEndpointRefused");
    expect(await reason(admin(a, { synthetic: false }), { ...info, isSandbox: true })).toBe(
      "error.sandboxRefused",
    );
    expect(await reason(admin(a))).toBe("submit.blocked.noPassingTest");
    expect(await reason(admin(a, { synthetic: true }), { ...info, isSandbox: true })).toBe(
      "submit.blocked.sandbox",
    );

    await passTest(a, id);
    expect(await reason(admin(a))).toBeNull();

    // No usable signing key: the key's own refusal, as Submit itself gives it, not "no passing test"
    // (a test can't pass without a key). Another live connection still comes first, like in Submit.
    const keyRefusal = async (code: "not_configured" | "key_unreadable") => {
      const missing: SigningDeps = {
        keyStore: () =>
          ({
            kid: async () => {
              throw new SigningKeyStoreError(code);
            },
          }) as never,
      };
      return withTenant(a, async (tx) =>
        submitBlockedReason(tx, admin(a), info, await resolveSigningKid(missing, id)),
      );
    };
    expect(await keyRefusal("not_configured")).toBe("test.error.keyNotConfigured");
    expect(await keyRefusal("key_unreadable")).toBe("test.error.keyUnavailable");
    // ... and the refusal the panel shows is the one Submit gives.
    const noKey: SigningDeps = {
      keyStore: () =>
        ({
          kid: async () => {
            throw new SigningKeyStoreError("not_configured");
          },
        }) as never,
    };
    const submitError = await refusal(submit(a, id, { deps: noKey }));
    expect(submitError.message).toBe(en.integrations["test.error.keyNotConfigured"]);

    const live = await draft();
    await passTest(a, live.id);
    await submit(a, live.id);
    expect(await reason(admin(a))).toBe("error.anotherConnectionLive");
  });
});

describe("submitConnection — withdraw, then submit again", () => {
  it("needs a fresh test and a fresh attestation, and writes fresh stamps", async () => {
    const { id } = await draft();
    await passTest(a, id);
    await submit(a, id);
    const first = await row(id);

    await withTenant(a, async (tx) => withdrawConnection(tx, admin(a), id, await stamp(a, id)));
    const withdrawn = await row(id);
    expect(withdrawn).toMatchObject({
      status: "draft",
      usResidencyAttestedAt: null,
      tokenEndpoint: null,
      issuer: null,
    });
    expect(await registryRows(id)).toEqual([]);

    // The old pass belonged to the old submission's discovery: Withdraw cleared it, so it can't be reused.
    const noTest = await refusal(submit(a, id));
    expect(noTest.message).toMatch(/Test connection has to pass first/);
    expect((await row(id)).status).toBe("draft");

    // A fresh test, but still no attestation carried over.
    await passTest(a, id);
    const noAttestation = await refusal(submit(a, id, { input: { attested: false } }));
    expect(noAttestation.field).toBe("attestation");
    expect((await row(id)).status).toBe("draft");

    // Both fresh: accepted, and the stamps are new (the 0042 trigger would refuse carried-over ones).
    expect((await submit(a, id)).status).toBe("pending_approval");
    const second = await row(id);
    expect(second.usResidencyAttestedAt!.getTime()).toBeGreaterThan(first.usResidencyAttestedAt!.getTime());
    expect(second.submittedAt!.getTime()).toBeGreaterThan(first.submittedAt!.getTime());
    expect(await registryRows(id)).toHaveLength(1);
    expect(await audits(id, "integration.connection_submitted")).toHaveLength(2);
  });
});

describe("submitConnection — the built-in sandbox", () => {
  // The in-process sandbox transport arrives in PI2b, so Test connection can't pass for a sandbox yet
  // (`test.error.sandboxUnavailable`). The domain path is real, though: these tests seed the pass
  // Test connection will record, exactly as the gate reads it.
  const SANDBOX_TOKEN_ENDPOINT = "https://sandbox.fhir.denialdesk.invalid/token";
  const SANDBOX_ISSUER = "sandbox-client";

  async function sandboxDraft(ctx: Ctx = a) {
    const { id } = await withTenant(ctx, (tx) =>
      createSandboxConnection(tx, admin(ctx, { synthetic: true }), { displayName: "Sandbox" }),
    );
    return id;
  }

  /** What a passing Test connection leaves: the pinned fixed endpoint and a `connection_tested` ok event. */
  async function seedPass(ctx: Ctx, id: string) {
    await systemDb()
      .update(integrationConnections)
      .set({
        tokenEndpoint: SANDBOX_TOKEN_ENDPOINT,
        tokenEndpointKey: SANDBOX_TOKEN_ENDPOINT,
        issuer: SANDBOX_ISSUER,
      })
      .where(eq(integrationConnections.id, id));
    await systemDb()
      .insert(auditEvents)
      .values({
        action: "integration.connection_tested",
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        entityType: "integration_connection",
        entityId: id,
        reason: "connection_test",
        metadata: {
          outcome: "ok",
          sandbox: true,
          base_url: SANDBOX_BASE_URL,
          client_id: SANDBOX_CLIENT_ID,
          kid: await keyStore.kid(),
          token_endpoint: SANDBOX_TOKEN_ENDPOINT,
          token_endpoint_key: SANDBOX_TOKEN_ENDPOINT,
          issuer: SANDBOX_ISSUER,
          pinned: true,
        },
      });
  }

  it("activates a tested sandbox, stamping the submission, with no attestation and no registry entry", async () => {
    const id = await sandboxDraft();
    await seedPass(a, id);
    const result = await submitConnection(
      runner(a),
      admin(a, { synthetic: true }),
      id,
      await stamp(a, id),
      { attested: false, locale: "en" },
      signing,
    );
    expect(result).toEqual({ status: "active" });
    expect(await row(id)).toMatchObject({
      status: "active",
      submittedBy: a.userId,
      usResidencyAttestedBy: null,
      usResidencyAttestedAt: null,
    });
    expect((await row(id)).submittedAt).not.toBeNull();
    expect(await registryRows(id)).toEqual([]);
    const [event] = await audits(id, "integration.connection_submitted");
    expect(event!.metadata).toMatchObject({ previous_status: "draft", status: "active", sandbox: true });
    expect(event!.metadata).not.toHaveProperty("us_residency_attested");
    expect(event!.metadata).not.toHaveProperty("attestation_version");
  });

  it("does not skip the test: an untested sandbox is refused", async () => {
    const id = await sandboxDraft();
    const error = await refusal(
      submitConnection(
        runner(a),
        admin(a, { synthetic: true }),
        id,
        await stamp(a, id),
        { attested: true, locale: "en" },
        signing,
      ),
    );
    expect(error.message).toMatch(/Test connection has to pass first/);
    expect((await row(id)).status).toBe("draft");
  });

  it("needs the step-up, too", async () => {
    const id = await sandboxDraft();
    await seedPass(a, id);
    const error = await refusal(
      submitConnection(
        runner(a),
        admin(a, { synthetic: true, mfa: false }),
        id,
        await stamp(a, id),
        { attested: false, locale: "en" },
        signing,
      ),
    );
    expect(error.stepUpRequired).toBe(true);
    expect((await row(id)).status).toBe("draft");
  });

  it("is refused in production, where the sandbox isn't available", async () => {
    const id = await sandboxDraft();
    await seedPass(a, id);
    const error = await refusal(
      submitConnection(
        runner(a),
        admin(a, { synthetic: false }),
        id,
        await stamp(a, id),
        { attested: false, locale: "en" },
        signing,
      ),
    );
    expect(error.message).toMatch(/isn't available in production/);
    expect((await row(id)).status).toBe("draft");
  });
});

describe("resumeConnection from error — a passing Test connection first", () => {
  /** A real connection that was tested, submitted, approved, and then went to `error`. */
  async function errored() {
    const { id } = await draft();
    await passTest(a, id);
    await submit(a, id);
    await approve(a, id);
    await setStatus(a, id, "error", "auth_failed");
    return id;
  }
  const resume = async (id: string, options: { mfa?: boolean; deps?: SigningDeps | null } = {}) =>
    withTenant(a, async (tx) =>
      resumeConnection(
        tx,
        admin(a, { mfa: options.mfa }),
        id,
        await stamp(a, id),
        undefined,
        // Resolved before the transaction, as the action does: the key's kid, from public material.
        options.deps === null ? undefined : await resolveSigningKid(options.deps ?? signing, id),
      ),
    );

  it("is refused right after the error: the pass from before it doesn't count, a new one does", async () => {
    const id = await errored();
    // `errored()` tested the draft, submitted, approved, and only then went to error.
    const error = await refusal(resume(id));
    expect(error.message).toMatch(/Run Test connection and get a pass before resuming/);
    expect((await row(id)).status).toBe("error");
    expect(await audits(id, "integration.connection_resumed")).toEqual([]);

    await passTest(a, id);
    await resume(id);
    expect((await row(id)).status).toBe("active");
  });

  it("is refused when the only pass was recorded while the connection was still active", async () => {
    const { id } = await draft();
    await passTest(a, id);
    await submit(a, id);
    await approve(a, id);
    // A fresh pass while active: the newest test, bound to the same configuration and key...
    await passTest(a, id);
    // ...then the connection errors. That pass came before the error and can't clear it.
    await setStatus(a, id, "error", "auth_failed");
    const error = await refusal(resume(id));
    expect(error.message).toMatch(/get a pass before resuming/);
    expect((await row(id)).status).toBe("error");
  });

  it("counts a test run after the error: Test connection never bumps updated_at on a connection past draft", async () => {
    const id = await errored();
    const before = (await row(id)).updatedAt.toISOString();
    await passTest(a, id);
    await testConnection(runner(a), admin(a), id, testDeps(failingToken()));
    await passTest(a, id);
    expect((await row(id)).updatedAt.toISOString()).toBe(before);
    await resume(id);
    expect((await row(id)).status).toBe("active");
  });

  it("is refused when the newest test failed, then allowed after a new pass", async () => {
    const id = await errored();
    const failed = await testConnection(runner(a), admin(a), id, testDeps(failingToken()));
    expect(failed.outcome).toBe("auth_refused");

    const error = await refusal(resume(id));
    expect(error.message).toMatch(/Run Test connection and get a pass before resuming/);
    expect(error.stepUpRequired).toBe(false);
    expect((await row(id)).status).toBe("error");
    expect(await audits(id, "integration.connection_resumed")).toEqual([]);

    await passTest(a, id);
    await resume(id);
    expect(await row(id)).toMatchObject({ status: "active", statusReason: null });
    const [event] = await audits(id, "integration.connection_resumed");
    expect(event!.metadata).toMatchObject({
      previous_status: "error",
      previous_status_reason: "auth_failed",
      step_up_verified_at: VERIFIED_AT,
      test_kid: await keyStore.kid(),
    });
  });

  it("is refused when no test is on record at all", async () => {
    const { id } = await draft();
    // No Test connection ever ran for this connection: stand in for Submit and the approval.
    await systemDb()
      .update(integrationConnections)
      .set({
        tokenEndpoint: FAKE_TOKEN_ENDPOINT,
        tokenEndpointKey: FAKE_TOKEN_ENDPOINT,
        issuer: FAKE_BASE_URL,
      })
      .where(eq(integrationConnections.id, id));
    await withTenant(a, async (tx) => {
      await tx.execute(sql`
        update integration_connections
        set status = 'pending_approval', submitted_by = ${a.userId}::uuid, submitted_at = now(),
            us_residency_attested_by = ${a.userId}::uuid, us_residency_attested_at = now()
        where id = ${id}::uuid
      `);
      await tx.execute(sql`select integration_registry_claim(${id}::uuid)`);
    });
    await approve(a, id);
    await setStatus(a, id, "error", "auth_failed");
    const error = await refusal(resume(id));
    expect(error.message).toMatch(/Run Test connection and get a pass before resuming/);
    expect((await row(id)).status).toBe("error");
  });

  it("is refused when the pass was for another signing key", async () => {
    const id = await errored();
    await passTest(a, id); // a valid pass after the error, for the key that signed it
    const error = await refusal(resume(id, { deps: { keyStore: () => otherKeyStore } }));
    expect(error.message).toMatch(/get a pass before resuming/);
    expect((await row(id)).status).toBe("error");
  });

  it("fails closed when the caller gives no way to identify the key", async () => {
    const id = await errored();
    await passTest(a, id); // a valid pass after the error: only the missing key stands in the way
    const error = await refusal(resume(id, { deps: null }));
    expect(error.message).toMatch(/get a pass before resuming/);
    expect((await row(id)).status).toBe("error");
  });

  it("still asks for the step-up first, and flags it", async () => {
    const id = await errored();
    const error = await refusal(resume(id, { mfa: false }));
    expect(error.stepUpRequired).toBe(true);
    expect((await row(id)).status).toBe("error");
  });

  it("does not ask for a test to resume from paused", async () => {
    const { id } = await draft();
    await passTest(a, id);
    await submit(a, id);
    await approve(a, id);
    await setStatus(a, id, "paused");
    // A failed test on record, and no signing deps at all: still resumes, since nothing errored.
    await testConnection(runner(a), admin(a), id, testDeps(failingToken()));
    await resume(id, { deps: null });
    expect((await row(id)).status).toBe("active");
    const [event] = await audits(id, "integration.connection_resumed");
    expect(event!.metadata).not.toHaveProperty("test_kid");
  });

  it("is not found across practices", async () => {
    const id = await errored();
    const error = await refusal(
      withTenant(b, async (tx) =>
        resumeConnection(
          tx,
          admin(b),
          id,
          new Date().toISOString(),
          undefined,
          await resolveSigningKid(signing, id),
        ),
      ),
    );
    expect(error.message).toMatch(/not found/);
    expect((await row(id)).status).toBe("error");
  });
});

describe("Submit's writes stay inside the app role's grants (no GRANT was added)", () => {
  const canUpdate = async (column: string) => {
    const result = await systemDb().execute<{ ok: boolean }>(sql`
      select has_column_privilege('denialdesk_app', 'integration_connections', ${column}, 'UPDATE') as ok
    `);
    return result.rows[0]!.ok;
  };

  it("Submit writes only columns the app role can already update, and never the approval columns", async () => {
    for (const column of [
      "status",
      "submitted_by",
      "submitted_at",
      "us_residency_attested_by",
      "us_residency_attested_at",
      "updated_by",
      "updated_at",
    ]) {
      expect(await canUpdate(column), column).toBe(true);
    }
    for (const column of ["approved_by", "approved_at", "approval_method", "population_scope"]) {
      expect(await canUpdate(column), column).toBe(false);
    }
  });
});
