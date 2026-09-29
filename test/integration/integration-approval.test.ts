import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { addCalendarDays, todayIn } from "@rules/calendar";
import type { OperatorContext } from "@/auth/operator";
import { closeDatabase, systemDb } from "@/db/client";
import {
  auditEvents,
  integrationConnections,
  integrationEndpointRegistry,
  memberships,
  tenants,
  users,
} from "@/db/schema";
import { withTenant, withTenantAsPlatform } from "@/db/tenant";
import {
  approveConnection,
  auditIntegrationViewed,
  getPendingApproval,
  jwksPathFor,
  listPendingApprovals,
  listPendingForPractice,
  rejectConnection,
  type ApproveInput,
} from "@/domain/integrations/approval";
import {
  createConnection,
  createSandboxConnection,
  getConnection,
  normalizedUrlForAudit,
  submitConnection,
  updateConnection,
  withdrawConnection,
  type IntegrationActor,
  type SigningDeps,
} from "@/domain/integrations/connections";
import { recordAgreement } from "@/domain/platform/agreements";
import { PracticeError } from "@/domain/platform/errors";
import {
  testConnection,
  type TestConnectionDeps,
  type TxRunner,
} from "@/domain/integrations/test-connection";
import type { MessageKey } from "@/i18n/messages/types";
import { EnvSharedKeyStore } from "@/integrations/fhir/keys";
import { FAKE_BASE_URL, FAKE_TOKEN_ENDPOINT, FakeFhirTransport } from "../support/fake-fhir-transport";
import { createTestTenant, expectDbError } from "./helpers";

/**
 * Fault injection for the atomicity tests: while `action` is set, the audit write for exactly that
 * action throws, after the decision's UPDATEs have run in the same transaction. Every other audit
 * write, and every test that doesn't set it, goes through the real `audit`.
 */
const auditFailure = vi.hoisted(() => ({ action: null as string | null }));
vi.mock("@/lib/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit")>();
  return {
    ...actual,
    audit: async (tx: Parameters<typeof actual.audit>[0], event: Parameters<typeof actual.audit>[1]) => {
      if (auditFailure.action !== null && event.action === auditFailure.action) {
        throw new Error("injected audit failure");
      }
      return actual.audit(tx, event);
    },
  };
});

// docs/specs/patient-integrations.md PI1c: the platform operator approves or rejects a submitted
// (`pending_approval`) real connection. R-7.2.4 (tenant isolation), R-7.5.1 (audit), R-3.3.1.
//
// Connections are made the way the application makes them: created, Test-connection-passed against
// the in-process fake FHIR server, and submitted, so the registry claim and the stamps are the ones
// Submit writes. The operator is a user with no practice membership (docs/specs/operator-login.md);
// the writes go through `withTenantAsPlatform` (owner privileges), and nothing here needs a GRANT.

type Ctx = { tenantId: string; userId: string };
let a: Ctx;
let b: Ctx;
let operator: OperatorContext;

const signingKey = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey;
const keyStore = new EnvSharedKeyStore(
  () => true,
  signingKey.export({ format: "pem", type: "pkcs8" }).toString(),
);
const signing: SigningDeps = { keyStore: () => keyStore };
const VERIFIED_AT = new Date(Date.now() - 60_000).toISOString();

const admin = (ctx: Ctx): IntegrationActor => ({
  ...ctx,
  role: "admin",
  syntheticOnly: false,
  recentMfa: true,
  stepUpVerifiedAt: VERIFIED_AT,
});
const runner =
  (ctx: Ctx): TxRunner =>
  (fn) =>
    withTenant(ctx, fn);
const testDeps = (transport: FakeFhirTransport): TestConnectionDeps => ({
  transportFor: () => transport,
  keyStore: () => keyStore,
});

/** Real-environment rules (Approve refuses where only synthetic data is allowed); the real clock. */
const OPTS = { syntheticOnly: false };
const today = () => todayIn();

beforeAll(async () => {
  const email = `operator-approval-${randomUUID().slice(0, 8)}@synthetic.test`;
  const [user] = await systemDb()
    .insert(users)
    .values({ email, displayName: "Platform operator", passwordHash: "unused" })
    .returning({ id: users.id });
  operator = { sessionId: randomUUID(), userId: user!.id, displayName: "Platform operator", email };
  // The domain checks the operator by the console's rule: the configured operator email AND no membership.
  vi.stubEnv("PLATFORM_OPERATOR_EMAIL", email);
});
// Test connection is rate limited per practice, so every test gets fresh practices.
beforeEach(async () => {
  auditFailure.action = null;
  a = await createTestTenant("Approval A");
  b = await createTestTenant("Approval B");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeDatabase();
});

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

async function passTest(ctx: Ctx, id: string) {
  const result = await testConnection(runner(ctx), admin(ctx), id, testDeps(FakeFhirTransport.healthy()));
  expect(result.outcome).toBe("ok");
}

async function row(id: string) {
  const [connection] = await systemDb()
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id));
  return connection!;
}
const stampOf = async (id: string) => (await row(id)).updatedAt.toISOString();

async function submit(ctx: Ctx, id: string) {
  return submitConnection(
    runner(ctx),
    admin(ctx),
    id,
    await stampOf(id),
    { attested: true, locale: "en" },
    signing,
  );
}

const pdf = Buffer.from("%PDF-1.7\n% synthetic approval test\n%%EOF\n", "latin1");

/** Records a signed BAA for the practice the way the operator does (synthetic bytes only). */
async function recordBaa(
  tenantId: string,
  dates: { effectiveDate: string; expiresOn: string | null } = {
    effectiveDate: "2026-01-01",
    expiresOn: null,
  },
) {
  await recordAgreement(
    {
      tenantId,
      ...dates,
      signedOn: "2025-12-31",
      practiceSigner: "Synthetic Signer, Practice Administrator",
      ourSigner: "Synthetic Officer, DenialDesk",
      note: null,
      filename: "synthetic-baa.pdf",
      content: pdf,
      attestedSynthetic: false,
    },
    operator,
    { syntheticOnly: false },
  );
}

/** Owner-only setup: when the practice submitted it (the approval date can't precede its Florida date). */
async function setSubmittedAt(id: string, at: string) {
  await systemDb().execute(
    sql`update integration_connections set submitted_at = ${at}::timestamptz where id = ${id}::uuid`,
  );
}

/** A connection submitted for approval (tested, attested, registry claimed). */
async function pending(ctx: Ctx = a, clientId?: string, options: { baa?: boolean } = {}) {
  // Approve needs a Business Associate Agreement in force (docs/specs/practice-agreements.md).
  if (options.baa !== false) await recordBaa(ctx.tenantId);
  const created = await draft(ctx, clientId);
  await passTest(ctx, created.id);
  await submit(ctx, created.id);
  return created;
}

async function registryRows(id: string) {
  return systemDb()
    .select()
    .from(integrationEndpointRegistry)
    .where(eq(integrationEndpointRegistry.connectionId, id));
}

async function audits(id: string, action: string) {
  const rows = await systemDb()
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.entityId, id))
    .orderBy(asc(auditEvents.id));
  return rows.filter((event) => event.action === action);
}

async function decisionAuditCount(id: string) {
  return (
    (await audits(id, "operator.integration_approved")).length +
    (await audits(id, "operator.integration_rejected")).length
  );
}

/** A complete, valid approval of `id` as the version the operator reviewed. */
async function approvalOf(
  ctx: Ctx,
  id: string,
  overrides: Partial<ApproveInput> = {},
): Promise<ApproveInput> {
  return {
    tenantId: ctx.tenantId,
    connectionId: id,
    expectedUpdatedAt: await stampOf(id),
    methodCode: "video_call",
    verifiedOn: today(),
    contactRole: "ehr_administrator",
    populationScope: "group_export",
    mrnNineDigitsVerified: true,
    clientIdOwnershipVerified: true,
    ...overrides,
  };
}

async function refusedWith(promise: Promise<unknown>, key: MessageKey<"operator">) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PracticeError) {
      expect(error.key).toBe(key);
      return error;
    }
    throw error;
  }
  throw new Error(`Expected a PracticeError (${key}), but the call succeeded`);
}

/** Nothing about the connection changed and no decision was audited. */
async function expectStillPending(id: string, updatedAt: string) {
  const stored = await row(id);
  expect(stored).toMatchObject({
    status: "pending_approval",
    approvedBy: null,
    approvedAt: null,
    approvalMethod: null,
    populationScope: null,
    mrnNineDigitsVerified: false,
  });
  expect(stored.updatedAt.toISOString()).toBe(updatedAt);
  expect(await decisionAuditCount(id)).toBe(0);
}

/** A practice member who is not the operator: any role, any practice. */
async function practiceMember(ctx: Ctx, role: "manager" | "specialist" | "compliance") {
  const suffix = randomUUID().slice(0, 8);
  const [user] = await systemDb()
    .insert(users)
    .values({
      email: `${role}-${suffix}@synthetic.test`,
      displayName: `Synthetic ${role}`,
      passwordHash: "unused",
    })
    .returning({ id: users.id });
  await systemDb().insert(memberships).values({ tenantId: ctx.tenantId, userId: user!.id, role });
  return user!.id;
}

/** A user with no practice membership whose email is not the operator's: not the operator. */
async function plainUser() {
  const [user] = await systemDb()
    .insert(users)
    .values({
      email: `plain-${randomUUID().slice(0, 8)}@synthetic.test`,
      displayName: "Synthetic bystander",
      passwordHash: "unused",
    })
    .returning({ id: users.id });
  return user!.id;
}

const asUser = (userId: string): OperatorContext => ({ ...operator, userId });

describe("the queue of connections awaiting approval", () => {
  it("lists every practice's pending connections, oldest first, with configuration only", async () => {
    const first = await pending(a);
    const second = await pending(b);
    // Not in the queue: a draft, a sandbox (never submitted for approval), an approved connection, a withdrawn one.
    const notSubmitted = await draft(a);
    const sandbox = await withTenant(a, (tx) =>
      createSandboxConnection(tx, { ...admin(a), syntheticOnly: true }, { displayName: "Sandbox" }),
    );
    const c = await createTestTenant("Approval C");
    const approved = await pending(c);
    await approveConnection(await approvalOf(c, approved.id), operator, OPTS);
    const d = await createTestTenant("Approval D");
    const withdrawn = await pending(d);
    await withTenant(d, async (tx) =>
      withdrawConnection(tx, admin(d), withdrawn.id, await stampOf(withdrawn.id)),
    );

    const queue = await listPendingApprovals(operator);
    const ids = queue.map((item) => item.connectionId);
    expect(ids).toContain(first.id);
    expect(ids).toContain(second.id);
    for (const other of [notSubmitted.id, sandbox.id, approved.id, withdrawn.id]) {
      expect(ids).not.toContain(other);
    }
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));

    const item = queue.find((entry) => entry.connectionId === first.id)!;
    const stored = await row(first.id);
    expect(item).toEqual({
      practiceId: a.tenantId,
      practiceName: (await systemDb().select().from(tenants).where(eq(tenants.id, a.tenantId)))[0]!.name,
      connectionId: first.id,
      displayName: "Main EHR",
      baseUrl: FAKE_BASE_URL,
      tokenEndpoint: FAKE_TOKEN_ENDPOINT,
      issuer: stored.issuer,
      clientId: first.clientId,
      mrnIdentifierSystem: "https://fhir.example.com/mrn",
      keyMode: null,
      populationScope: null,
      jwksPath: jwksPathFor(first.id),
      submittedAt: stored.submittedAt,
      attestedAt: stored.usResidencyAttestedAt,
      updatedAt: stored.updatedAt.toISOString(),
    });
    // Configuration only: no key reference, no exception text, nobody's user ID, nothing of a patient.
    expect(Object.keys(item).sort()).toEqual(
      [
        "attestedAt",
        "baseUrl",
        "clientId",
        "connectionId",
        "displayName",
        "issuer",
        "jwksPath",
        "keyMode",
        "mrnIdentifierSystem",
        "populationScope",
        "practiceId",
        "practiceName",
        "submittedAt",
        "tokenEndpoint",
        "updatedAt",
      ].sort(),
    );
  });

  it("one practice's page lists only that practice's connections", async () => {
    const mine = await pending(a);
    const theirs = await pending(b);
    const forA = await listPendingForPractice(a.tenantId, operator);
    expect(forA.map((item) => item.connectionId)).toEqual([mine.id]);
    const forB = await listPendingForPractice(b.tenantId, operator);
    expect(forB.map((item) => item.connectionId)).toEqual([theirs.id]);
    expect(await listPendingForPractice(randomUUID(), operator)).toEqual([]);
  });

  it("finds a connection only under its own practice", async () => {
    const mine = await pending(a);
    expect((await getPendingApproval(a.tenantId, mine.id, operator))?.connectionId).toBe(mine.id);
    expect(await getPendingApproval(b.tenantId, mine.id, operator)).toBeNull();
    expect(await getPendingApproval(a.tenantId, randomUUID(), operator)).toBeNull();
  });

  it("is for the operator only: a practice administrator or member is refused", async () => {
    await pending(a);
    const specialist = await practiceMember(a, "specialist");
    for (const userId of [a.userId, specialist, await plainUser(), randomUUID()]) {
      await refusedWith(listPendingApprovals(asUser(userId)), "errors.integrationNotOperator");
      await refusedWith(listPendingForPractice(a.tenantId, asUser(userId)), "errors.integrationNotOperator");
      await refusedWith(
        getPendingApproval(a.tenantId, randomUUID(), asUser(userId)),
        "errors.integrationNotOperator",
      );
    }
  });
});

describe("approveConnection", () => {
  it("activates the connection with a fresh approval stamp, the verification, and the scope, keeping the claim", async () => {
    const { id, clientId } = await pending();
    const before = await row(id);
    const reviewed = await stampOf(id);

    const result = await approveConnection(await approvalOf(a, id), operator, OPTS);
    expect(result).toEqual({ connectionId: id });

    const stored = await row(id);
    expect(stored).toMatchObject({
      status: "active",
      statusReason: null,
      approvedBy: operator.userId,
      approvalMethod: "video_call",
      populationScope: "group_export",
      mrnNineDigitsVerified: true,
      updatedBy: operator.userId,
      tenantId: a.tenantId,
      // What the practice submitted is untouched.
      baseUrl: before.baseUrl,
      clientId,
      tokenEndpoint: before.tokenEndpoint,
      submittedBy: before.submittedBy,
      usResidencyAttestedBy: before.usResidencyAttestedBy,
    });
    expect(stored.approvedAt).not.toBeNull();
    // approved_at is the statement's clock (now(), the transaction start); drizzle/0043 stamps
    // updated_at with clock_timestamp() on every status change, so it is at or just after it.
    expect(stored.updatedAt.getTime()).toBeGreaterThanOrEqual(stored.approvedAt!.getTime());
    expect(stored.updatedAt.getTime()).toBeGreaterThanOrEqual(new Date(reviewed).getTime());
    // The registry claim stays while the connection is live.
    expect(await registryRows(id)).toHaveLength(1);
    // The practice's own session now reads it as active, with the stamp.
    const seen = await withTenant(a, (tx) => getConnection(tx, id));
    expect(seen).toMatchObject({ status: "active" });
    expect(seen!.approvedAt).not.toBeNull();
  });

  it("records the verification in the audit event: method, date, the contact's role, scope, ownership, configuration", async () => {
    const { id, clientId } = await pending();
    await setSubmittedAt(id, new Date(Date.now() - 3 * 86_400_000).toISOString());
    const before = await row(id);
    const yesterday = addCalendarDays(today(), -1);
    await approveConnection(
      await approvalOf(a, id, {
        methodCode: "phone_callback",
        verifiedOn: yesterday,
        contactRole: "it_contact",
        populationScope: "group_export",
        mrnNineDigitsVerified: false,
      }),
      operator,
      OPTS,
    );
    const events = await audits(id, "operator.integration_approved");
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event).toMatchObject({
      actorUserId: operator.userId,
      tenantId: a.tenantId,
      entityType: "integration_connection",
      entityId: id,
      reason: "phone_callback",
    });
    expect(event!.metadata).toEqual({
      previous_status: "pending_approval",
      status: "active",
      approval_method: "phone_callback",
      verified_on: yesterday,
      contact_role: "it_contact",
      population_scope: "group_export",
      mrn_nine_digits_verified: false,
      client_id_ownership_verified: true,
      registry_verified: true,
      session_id: operator.sessionId,
      base_url: FAKE_BASE_URL,
      client_id: clientId,
      mrn_identifier_system: "https://fhir.example.com/mrn",
      token_endpoint: normalizedUrlForAudit(before.tokenEndpoint),
      issuer: normalizedUrlForAudit(before.issuer),
      key_mode: null,
    });
    // Nothing of another practice, and no free text or names: only codes, a date, and configuration.
    expect(JSON.stringify(event)).not.toContain(b.tenantId);
    expect(JSON.stringify(event!.metadata)).not.toMatch(/token=|secret|password/i);
  });

  it("takes the verification date as of the operator's today: today is accepted, the future is not", async () => {
    const { id } = await pending();
    const reviewed = await stampOf(id);
    for (const days of [1, 2, 400]) {
      await refusedWith(
        approveConnection(
          await approvalOf(a, id, { verifiedOn: addCalendarDays(today(), days) }),
          operator,
          OPTS,
        ),
        "errors.approvalDateInvalid",
      );
    }
    await expectStillPending(id, reviewed);
    await approveConnection(await approvalOf(a, id, { verifiedOn: today() }), operator, OPTS);
    expect((await row(id)).status).toBe("active");
  });

  it("puts the earliest verification date at the Florida date of the submission: day before refused, day of and day after accepted", async () => {
    // Submitted at 22:30 on June 15 in Florida, which is already June 16 in UTC: the Florida date counts.
    const submittedAt = "2026-06-16T02:30:00Z";
    const first = await pending(a);
    await setSubmittedAt(first.id, submittedAt);
    for (const verifiedOn of ["2026-06-14", "2025-12-31"]) {
      const error = await refusedWith(
        approveConnection(await approvalOf(a, first.id, { verifiedOn }), operator, OPTS),
        "errors.approvalDateBeforeSubmission",
      );
      expect(error.params).toEqual({ date: "2026-06-15" });
    }
    await expectStillPending(first.id, await stampOf(first.id));
    // The day of (by the Florida calendar, though UTC says the 16th) ...
    await approveConnection(await approvalOf(a, first.id, { verifiedOn: "2026-06-15" }), operator, OPTS);
    expect((await row(first.id)).status).toBe("active");
    // ... and the day after.
    const second = await pending(b);
    await setSubmittedAt(second.id, submittedAt);
    await approveConnection(await approvalOf(b, second.id, { verifiedOn: "2026-06-16" }), operator, OPTS);
    expect((await row(second.id)).status).toBe("active");
  });

  it.each(["", "not a date", "2026-02-30", "2026-9-28", "28/09/2026", "2026-09-28T00:00:00Z"])(
    "refuses the verification date %j",
    async (verifiedOn) => {
      const { id } = await pending();
      const reviewed = await stampOf(id);
      await refusedWith(
        approveConnection(await approvalOf(a, id, { verifiedOn }), operator, OPTS),
        "errors.approvalDateInvalid",
      );
      await expectStillPending(id, reviewed);
    },
  );

  it.each([
    ["methodCode", ""],
    ["methodCode", "carrier_pigeon"],
    ["methodCode", "VIDEO_CALL"],
    ["contactRole", ""],
    ["contactRole", "Dr. Synthetic Person"],
    ["populationScope", ""],
    ["populationScope", "everyone"],
    ["populationScope", "group_export "],
  ] as const)(
    "refuses %s = %j: a fixed vocabulary, nothing else is accepted or stored",
    async (field, value) => {
      const { id } = await pending();
      const reviewed = await stampOf(id);
      await refusedWith(
        approveConnection(await approvalOf(a, id, { [field]: value }), operator, OPTS),
        "errors.approvalFormInvalid",
      );
      await expectStillPending(id, reviewed);
    },
  );

  it("refuses a verified search filter: it would record a claim with nowhere to put the filter", async () => {
    const { id } = await pending();
    const reviewed = await stampOf(id);
    await refusedWith(
      approveConnection(await approvalOf(a, id, { populationScope: "verified_filter" }), operator, OPTS),
      "errors.approvalScopeUnsupported",
    );
    await expectStillPending(id, reviewed);
    await approveConnection(await approvalOf(a, id, { populationScope: "group_export" }), operator, OPTS);
    expect((await row(id)).populationScope).toBe("group_export");
  });

  it("applies the environment rule: a real connection is never approved where only synthetic data is allowed", async () => {
    const { id } = await pending();
    const reviewed = await stampOf(id);
    await refusedWith(
      approveConnection(await approvalOf(a, id), operator, { syntheticOnly: true }),
      "errors.integrationRealEndpointRefused",
    );
    // Without an explicit option it is the server's own environment: pinned here to a non-production one.
    const appEnv = process.env.APP_ENV ?? "development";
    vi.stubEnv("APP_ENV", "development");
    try {
      await refusedWith(
        approveConnection(await approvalOf(a, id), operator),
        "errors.integrationRealEndpointRefused",
      );
    } finally {
      vi.stubEnv("APP_ENV", appEnv);
    }
    await expectStillPending(id, reviewed);
    await approveConnection(await approvalOf(a, id), operator, { syntheticOnly: false });
    expect((await row(id)).status).toBe("active");
  });

  it("requires a Business Associate Agreement in force: none, expired, or not yet effective is refused", async () => {
    const none = await pending(a, undefined, { baa: false });
    await refusedWith(
      approveConnection(await approvalOf(a, none.id), operator, OPTS),
      "errors.approvalBaaRequired",
    );
    await expectStillPending(none.id, await stampOf(none.id));
    // Recorded now, it covers today and the connection can be approved.
    await recordBaa(a.tenantId);
    await approveConnection(await approvalOf(a, none.id), operator, OPTS);
    expect((await row(none.id)).status).toBe("active");

    const expired = await createTestTenant("Approval expired BAA");
    const expiredConnection = await pending(expired, undefined, { baa: false });
    await recordBaa(expired.tenantId, { effectiveDate: "2020-01-01", expiresOn: "2020-12-31" });
    await refusedWith(
      approveConnection(await approvalOf(expired, expiredConnection.id), operator, OPTS),
      "errors.approvalBaaRequired",
    );
    await expectStillPending(expiredConnection.id, await stampOf(expiredConnection.id));

    const future = await createTestTenant("Approval future BAA");
    const futureConnection = await pending(future, undefined, { baa: false });
    await recordBaa(future.tenantId, { effectiveDate: addCalendarDays(today(), 30), expiresOn: null });
    await refusedWith(
      approveConnection(await approvalOf(future, futureConnection.id), operator, OPTS),
      "errors.approvalBaaRequired",
    );
    await expectStillPending(futureConnection.id, await stampOf(futureConnection.id));
  });

  it("accepts an agreement that is in force but expiring soon", async () => {
    const soon = await createTestTenant("Approval expiring BAA");
    const { id } = await pending(soon, undefined, { baa: false });
    await recordBaa(soon.tenantId, { effectiveDate: "2026-01-01", expiresOn: addCalendarDays(today(), 20) });
    await approveConnection(await approvalOf(soon, id), operator, OPTS);
    expect((await row(id)).status).toBe("active");
  });

  it("does not require a BAA to reject: refusing a connection is the safe direction", async () => {
    const { id } = await pending(a, undefined, { baa: false });
    await rejectConnection(
      { tenantId: a.tenantId, connectionId: id, expectedUpdatedAt: await stampOf(id), reasonCode: "other" },
      operator,
    );
    expect((await row(id)).status).toBe("draft");
  });

  it("requires the operator's confirmation that the practice owns the client ID", async () => {
    const { id } = await pending();
    const reviewed = await stampOf(id);
    await refusedWith(
      approveConnection(await approvalOf(a, id, { clientIdOwnershipVerified: false }), operator, OPTS),
      "errors.approvalOwnershipRequired",
    );
    await refusedWith(
      approveConnection(
        await approvalOf(a, id, { clientIdOwnershipVerified: "on" as unknown as boolean }),
        operator,
        OPTS,
      ),
      "errors.approvalOwnershipRequired",
    );
    await expectStillPending(id, reviewed);
  });

  it("is for the operator only: a practice administrator or member is refused, and nothing changes", async () => {
    const { id } = await pending();
    const reviewed = await stampOf(id);
    const input = await approvalOf(a, id);
    const specialist = await practiceMember(a, "specialist");
    const manager = await practiceMember(a, "manager");
    const otherPracticeAdmin = b.userId;
    // The last two belong to no practice but are not the operator either (not its email; unknown).
    for (const userId of [
      a.userId,
      specialist,
      manager,
      otherPracticeAdmin,
      await plainUser(),
      randomUUID(),
    ]) {
      await refusedWith(approveConnection(input, asUser(userId), OPTS), "errors.integrationNotOperator");
    }
    await expectStillPending(id, reviewed);
  });

  it("refuses another practice's connection: named with the wrong practice it is not found", async () => {
    const mine = await pending(a);
    const theirs = await pending(b);
    const reviewed = { mine: await stampOf(mine.id), theirs: await stampOf(theirs.id) };
    // The connection is A's; the request names B.
    await refusedWith(
      approveConnection({ ...(await approvalOf(a, mine.id)), tenantId: b.tenantId }, operator, OPTS),
      "errors.integrationNotFound",
    );
    // A connection ID that exists nowhere.
    await refusedWith(
      approveConnection({ ...(await approvalOf(a, mine.id)), connectionId: randomUUID() }, operator, OPTS),
      "errors.integrationNotFound",
    );
    // A practice that doesn't exist.
    await refusedWith(
      approveConnection({ ...(await approvalOf(a, mine.id)), tenantId: randomUUID() }, operator, OPTS),
      "errors.practiceNotFound",
    );
    await expectStillPending(mine.id, reviewed.mine);
    await expectStillPending(theirs.id, reviewed.theirs);
  });

  it("refuses a page that went stale: a change since it was opened means review it again", async () => {
    const { id } = await pending();
    const reviewed = await stampOf(id);
    // The practice renamed it after the operator opened the page (a name is shown to the operator).
    await withTenant(a, (tx) => updateConnection(tx, admin(a), id, reviewed, { displayName: "Renamed EHR" }));
    const renamed = await stampOf(id);
    expect(renamed).not.toBe(reviewed);
    await refusedWith(
      approveConnection(await approvalOf(a, id, { expectedUpdatedAt: reviewed }), operator, OPTS),
      "errors.integrationStale",
    );
    await expectStillPending(id, renamed);
    // Reviewed again, it goes through.
    await approveConnection(await approvalOf(a, id), operator, OPTS);
    expect((await row(id)).status).toBe("active");
  });

  it.each(["", "not a timestamp", "2020-01-01T00:00:00.000Z"])(
    "refuses a missing or wrong reviewed version %j",
    async (expectedUpdatedAt) => {
      const { id } = await pending();
      const reviewed = await stampOf(id);
      await refusedWith(
        approveConnection(await approvalOf(a, id, { expectedUpdatedAt }), operator, OPTS),
        "errors.integrationStale",
      );
      await expectStillPending(id, reviewed);
    },
  );

  it("refuses a connection that is no longer awaiting approval: withdrawn, or already approved", async () => {
    const withdrawn = await pending(a);
    const stale = await approvalOf(a, withdrawn.id);
    await withTenant(a, async (tx) =>
      withdrawConnection(tx, admin(a), withdrawn.id, await stampOf(withdrawn.id)),
    );
    await refusedWith(approveConnection(stale, operator, OPTS), "errors.integrationNotPending");
    // A withdrawn draft is not approvable even with a freshly read stamp.
    await refusedWith(
      approveConnection(await approvalOf(a, withdrawn.id), operator, OPTS),
      "errors.integrationNotPending",
    );
    expect((await row(withdrawn.id)).status).toBe("draft");

    const done = await pending(b);
    await approveConnection(await approvalOf(b, done.id), operator, OPTS);
    const approvedAt = (await row(done.id)).approvedAt;
    await refusedWith(
      approveConnection(await approvalOf(b, done.id), operator, OPTS),
      "errors.integrationNotPending",
    );
    // The first approval's record is not overwritten by a second attempt.
    expect((await row(done.id)).approvedAt).toEqual(approvedAt);
    expect(await audits(done.id, "operator.integration_approved")).toHaveLength(1);
  });

  it("refuses the built-in sandbox, which never awaits approval", async () => {
    const sandbox = await withTenant(a, (tx) =>
      createSandboxConnection(tx, { ...admin(a), syntheticOnly: true }, { displayName: "Sandbox" }),
    );
    await refusedWith(
      approveConnection(await approvalOf(a, sandbox.id), operator, OPTS),
      "errors.integrationNotFound",
    );
    expect((await row(sandbox.id)).approvedBy).toBeNull();
  });

  it("refuses when the registry claim is missing or no longer matches the configuration", async () => {
    const missing = await pending(a);
    const missingStamp = await stampOf(missing.id);
    await systemDb().execute(
      sql`delete from integration_endpoint_registry where connection_id = ${missing.id}::uuid`,
    );
    await refusedWith(
      approveConnection(await approvalOf(a, missing.id), operator, OPTS),
      "errors.integrationNotClaimed",
    );
    await expectStillPending(missing.id, missingStamp);

    // The claim exists but names something else than this connection's configuration.
    for (const column of ["client_id", "endpoint_key", "token_endpoint_key"] as const) {
      const ctx = await createTestTenant(`Approval claim ${column}`);
      const other = await pending(ctx);
      const stamp = await stampOf(other.id);
      await systemDb().execute(
        sql`update integration_endpoint_registry
            set ${sql.identifier(column)} = ${`other-${randomUUID()}`}
            where connection_id = ${other.id}::uuid`,
      );
      await refusedWith(
        approveConnection(await approvalOf(ctx, other.id), operator, OPTS),
        "errors.integrationNotClaimed",
      );
      await expectStillPending(other.id, stamp);
    }
  });

  it("refuses a suspended practice (suspension is a stop the operator set), and approves once it is reactivated", async () => {
    const { id } = await pending();
    const reviewed = await stampOf(id);
    await systemDb().update(tenants).set({ suspendedAt: new Date() }).where(eq(tenants.id, a.tenantId));
    await refusedWith(
      approveConnection(await approvalOf(a, id), operator, OPTS),
      "errors.integrationPracticeSuspended",
    );
    await expectStillPending(id, reviewed);
    await systemDb().update(tenants).set({ suspendedAt: null }).where(eq(tenants.id, a.tenantId));
    await approveConnection(await approvalOf(a, id), operator, OPTS);
    expect((await row(id)).status).toBe("active");
  });

  it("the stamp is fresh even when a stale approval was carried onto the pending row", async () => {
    const { id } = await pending();
    // Owner-only setup: an old approval stamp sitting on the pending row (0040's "carried over" case).
    const carried = new Date("2020-01-01T00:00:00Z");
    await withTenantAsPlatform(a, (tx) =>
      tx.execute(sql`
        update integration_connections
        set approved_by = ${operator.userId}::uuid, approved_at = ${carried.toISOString()}::timestamptz
        where id = ${id}::uuid`),
    );
    // The database refuses to activate on the carried stamp alone (the trigger's rule, for any role) ...
    await expectDbError(
      withTenantAsPlatform(a, (tx) =>
        tx.execute(sql`update integration_connections set status = 'active' where id = ${id}::uuid`),
      ),
      /activation requires a fresh approval/,
    );
    // ... and the operator's Approve writes a new one.
    await approveConnection(await approvalOf(a, id), operator, OPTS);
    const stored = await row(id);
    expect(stored.approvedAt!.getTime()).toBeGreaterThan(carried.getTime());
    expect(stored.approvedAt!.getTime()).toBeGreaterThanOrEqual(stored.submittedAt!.getTime());
  });
});

describe("rejectConnection", () => {
  it("sends the connection back to draft with the reason, releases the claim, and clears the submission's leftovers", async () => {
    const { id, clientId } = await pending();
    const before = await row(id);
    const reviewed = await stampOf(id);
    expect(await registryRows(id)).toHaveLength(1);

    const result = await rejectConnection(
      {
        tenantId: a.tenantId,
        connectionId: id,
        expectedUpdatedAt: reviewed,
        reasonCode: "client_id_not_verified",
      },
      operator,
    );
    expect(result).toEqual({ connectionId: id, registryReleased: true });

    const stored = await row(id);
    expect(stored).toMatchObject({
      status: "draft",
      statusReason: "client_id_not_verified",
      updatedBy: operator.userId,
      // Never approved: the approval columns stay empty.
      approvedBy: null,
      approvedAt: null,
      approvalMethod: null,
      populationScope: null,
      mrnNineDigitsVerified: false,
      // What belonged to the rejected submission is cleared (as Withdraw does): the endpoint is
      // editable again, so its attestation and discovered token endpoint must not carry over.
      usResidencyAttestedBy: null,
      usResidencyAttestedAt: null,
      tokenEndpoint: null,
      tokenEndpointKey: null,
      issuer: null,
      // The submission stamp stays: the record that it was submitted once.
      submittedBy: before.submittedBy,
      // The configuration the practice entered is untouched.
      baseUrl: before.baseUrl,
      clientId,
    });
    expect(stored.submittedAt).toEqual(before.submittedAt);
    // The claim is released, in the database function, after the status change.
    expect(await registryRows(id)).toEqual([]);
    // The practice can see why.
    expect((await withTenant(a, (tx) => getConnection(tx, id)))!.statusReason).toBe("client_id_not_verified");
  });

  it("audits operator.integration_rejected with the reason code and what was cleared, and nothing else", async () => {
    const { id, clientId } = await pending();
    const before = await row(id);
    await rejectConnection(
      {
        tenantId: a.tenantId,
        connectionId: id,
        expectedUpdatedAt: await stampOf(id),
        reasonCode: "endpoint_not_verified",
      },
      operator,
    );
    const events = await audits(id, "operator.integration_rejected");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: operator.userId,
      tenantId: a.tenantId,
      entityType: "integration_connection",
      entityId: id,
      reason: "endpoint_not_verified",
    });
    expect(events[0]!.metadata).toEqual({
      previous_status: "pending_approval",
      status: "draft",
      reason_code: "endpoint_not_verified",
      registry_released: true,
      attestation_cleared: true,
      discovery_cleared: true,
      session_id: operator.sessionId,
      previous_attested_by: before.usResidencyAttestedBy,
      previous_attested_at: before.usResidencyAttestedAt!.toISOString(),
      base_url: FAKE_BASE_URL,
      client_id: clientId,
      mrn_identifier_system: "https://fhir.example.com/mrn",
      token_endpoint: normalizedUrlForAudit(before.tokenEndpoint),
      issuer: normalizedUrlForAudit(before.issuer),
      key_mode: null,
    });
    expect(JSON.stringify(events[0])).not.toContain(b.tenantId);
    expect(await audits(id, "operator.integration_approved")).toEqual([]);
  });

  it("frees the endpoint and client ID: another practice can then submit them, and refused before", async () => {
    const shared = `shared-client-${randomUUID().slice(0, 8)}`;
    const first = await pending(a, shared);
    const second = await draft(b, shared);
    await passTest(b, second.id);
    await expect(submit(b, second.id)).rejects.toThrow(/already connected/);

    await rejectConnection(
      {
        tenantId: a.tenantId,
        connectionId: first.id,
        expectedUpdatedAt: await stampOf(first.id),
        reasonCode: "other",
      },
      operator,
    );
    expect(await submit(b, second.id)).toEqual({ status: "pending_approval" });
    expect((await registryRows(second.id))[0]).toMatchObject({ connectionId: second.id, clientId: shared });
  });

  it("leaves other connections' claims alone", async () => {
    const mine = await pending(a);
    const theirs = await pending(b);
    await rejectConnection(
      {
        tenantId: a.tenantId,
        connectionId: mine.id,
        expectedUpdatedAt: await stampOf(mine.id),
        reasonCode: "other",
      },
      operator,
    );
    expect(await registryRows(mine.id)).toEqual([]);
    expect(await registryRows(theirs.id)).toHaveLength(1);
    expect((await row(theirs.id)).status).toBe("pending_approval");
  });

  it("lets the practice correct it and submit again, needing a fresh test and attestation", async () => {
    const { id } = await pending();
    const first = await row(id);
    await rejectConnection(
      {
        tenantId: a.tenantId,
        connectionId: id,
        expectedUpdatedAt: await stampOf(id),
        reasonCode: "configuration_incorrect",
      },
      operator,
    );
    // Draft again: the old pass names a token endpoint that was cleared, so a new test is needed.
    await expect(submit(a, id)).rejects.toThrow(/Test connection has to pass first/);
    await passTest(a, id);
    expect(await submit(a, id)).toEqual({ status: "pending_approval" });
    const again = await row(id);
    expect(again).toMatchObject({ status: "pending_approval", statusReason: null });
    expect(again.usResidencyAttestedAt!.getTime()).toBeGreaterThan(first.usResidencyAttestedAt!.getTime());
    expect(again.submittedAt!.getTime()).toBeGreaterThan(first.submittedAt!.getTime());
    expect(await registryRows(id)).toHaveLength(1);
    // And it can be approved this time.
    await approveConnection(await approvalOf(a, id), operator, OPTS);
    expect((await row(id)).status).toBe("active");
  });

  it.each(["", "Patient Synthetic Person is unknown", "ENDPOINT_NOT_VERIFIED", "endpoint_not_verified "])(
    "takes only a code from the fixed vocabulary: refuses %j, storing nothing",
    async (reasonCode) => {
      const { id } = await pending();
      const reviewed = await stampOf(id);
      await refusedWith(
        rejectConnection(
          { tenantId: a.tenantId, connectionId: id, expectedUpdatedAt: reviewed, reasonCode },
          operator,
        ),
        "errors.rejectReasonRequired",
      );
      await expectStillPending(id, reviewed);
      expect(await registryRows(id)).toHaveLength(1);
    },
  );

  it("is for the operator only: a practice administrator or member is refused, and the claim stays", async () => {
    const { id } = await pending();
    const reviewed = await stampOf(id);
    const specialist = await practiceMember(a, "specialist");
    for (const userId of [a.userId, specialist, b.userId, await plainUser(), randomUUID()]) {
      await refusedWith(
        rejectConnection(
          { tenantId: a.tenantId, connectionId: id, expectedUpdatedAt: reviewed, reasonCode: "other" },
          asUser(userId),
        ),
        "errors.integrationNotOperator",
      );
    }
    await expectStillPending(id, reviewed);
    expect(await registryRows(id)).toHaveLength(1);
  });

  it("refuses another practice's connection, a stale page, and a connection not awaiting approval", async () => {
    const mine = await pending(a);
    const reviewed = await stampOf(mine.id);
    await refusedWith(
      rejectConnection(
        { tenantId: b.tenantId, connectionId: mine.id, expectedUpdatedAt: reviewed, reasonCode: "other" },
        operator,
      ),
      "errors.integrationNotFound",
    );
    await withTenant(a, (tx) =>
      updateConnection(tx, admin(a), mine.id, reviewed, { displayName: "Renamed EHR" }),
    );
    await refusedWith(
      rejectConnection(
        { tenantId: a.tenantId, connectionId: mine.id, expectedUpdatedAt: reviewed, reasonCode: "other" },
        operator,
      ),
      "errors.integrationStale",
    );
    expect(await registryRows(mine.id)).toHaveLength(1);

    // Not awaiting approval: a draft, and an approved (active) connection are not rejected, and an
    // active connection keeps its claim.
    const notSubmitted = await draft(b);
    await refusedWith(
      rejectConnection(
        {
          tenantId: b.tenantId,
          connectionId: notSubmitted.id,
          expectedUpdatedAt: await stampOf(notSubmitted.id),
          reasonCode: "other",
        },
        operator,
      ),
      "errors.integrationNotPending",
    );
    const e = await createTestTenant("Approval E");
    const live = await pending(e);
    await approveConnection(await approvalOf(e, live.id), operator, OPTS);
    await refusedWith(
      rejectConnection(
        {
          tenantId: e.tenantId,
          connectionId: live.id,
          expectedUpdatedAt: await stampOf(live.id),
          reasonCode: "other",
        },
        operator,
      ),
      "errors.integrationNotPending",
    );
    expect((await row(live.id)).status).toBe("active");
    expect(await registryRows(live.id)).toHaveLength(1);
    expect(await decisionAuditCount(mine.id)).toBe(0);
  });

  it("still works for a suspended practice: refusing a connection is the safe direction", async () => {
    const { id } = await pending();
    await systemDb().update(tenants).set({ suspendedAt: new Date() }).where(eq(tenants.id, a.tenantId));
    await rejectConnection(
      { tenantId: a.tenantId, connectionId: id, expectedUpdatedAt: await stampOf(id), reasonCode: "other" },
      operator,
    );
    expect((await row(id)).status).toBe("draft");
    expect(await registryRows(id)).toEqual([]);
  });
});

describe("a decision is atomic with its audit event (PR #89 follow-up N1)", () => {
  it("approve: if the audit write fails after the UPDATE, nothing is decided and the claim is kept", async () => {
    const { id } = await pending();
    const before = await row(id);
    const claimBefore = await registryRows(id);
    expect(claimBefore).toHaveLength(1);
    const input = await approvalOf(a, id);

    auditFailure.action = "operator.integration_approved";
    await expect(approveConnection(input, operator, OPTS)).rejects.toThrow("injected audit failure");
    auditFailure.action = null;

    // The UPDATE ran, then the audit threw: the whole transaction rolled back. Still pending, with
    // no approval stamp, method, scope, or `updated_at` change, the same claim, and no decision audit.
    await expectStillPending(id, before.updatedAt.toISOString());
    expect(await row(id)).toEqual(before);
    expect(await registryRows(id)).toEqual(claimBefore);
    expect(await audits(id, "operator.integration_approved")).toEqual([]);

    // The decision can still be made afterwards, on the same reviewed version.
    await approveConnection(input, operator, OPTS);
    expect((await row(id)).status).toBe("active");
    expect(await audits(id, "operator.integration_approved")).toHaveLength(1);
  });

  it("reject: if the audit write fails after the UPDATEs and the release, the submission and the claim are untouched", async () => {
    const { id } = await pending();
    const before = await row(id);
    const claimBefore = await registryRows(id);
    expect(claimBefore).toHaveLength(1);
    const input = {
      tenantId: a.tenantId,
      connectionId: id,
      expectedUpdatedAt: before.updatedAt.toISOString(),
      reasonCode: "endpoint_not_verified",
    };

    auditFailure.action = "operator.integration_rejected";
    await expect(rejectConnection(input, operator)).rejects.toThrow("injected audit failure");
    auditFailure.action = null;

    // Both UPDATEs (the move to draft, and clearing the attestation and discovery) and the registry
    // release ran before the audit threw: all of it rolled back.
    await expectStillPending(id, before.updatedAt.toISOString());
    expect(await row(id)).toEqual(before);
    expect(await registryRows(id)).toEqual(claimBefore);
    expect(await audits(id, "operator.integration_rejected")).toEqual([]);

    await rejectConnection(input, operator);
    expect((await row(id)).status).toBe("draft");
    expect(await registryRows(id)).toEqual([]);
  });
});

describe("the operator's account (PR #89 follow-up N4)", () => {
  it("refuses a disabled operator account everywhere, writing nothing, and works again once re-enabled", async () => {
    const { id } = await pending();
    const reviewed = await stampOf(id);
    const input = await approvalOf(a, id);
    await systemDb().update(users).set({ disabledAt: new Date() }).where(eq(users.id, operator.userId));
    try {
      await refusedWith(approveConnection(input, operator, OPTS), "errors.integrationNotOperator");
      await refusedWith(
        rejectConnection(
          { tenantId: a.tenantId, connectionId: id, expectedUpdatedAt: reviewed, reasonCode: "other" },
          operator,
        ),
        "errors.integrationNotOperator",
      );
      await refusedWith(listPendingApprovals(operator), "errors.integrationNotOperator");
      await refusedWith(listPendingForPractice(a.tenantId, operator), "errors.integrationNotOperator");
      await refusedWith(getPendingApproval(a.tenantId, id, operator), "errors.integrationNotOperator");
      await expectStillPending(id, reviewed);
      expect(await registryRows(id)).toHaveLength(1);
    } finally {
      await systemDb().update(users).set({ disabledAt: null }).where(eq(users.id, operator.userId));
    }
    await approveConnection(input, operator, OPTS);
    expect((await row(id)).status).toBe("active");
  });
});

describe("viewing the queue and a review page is audited with the operator's session (PR #89 follow-up N3)", () => {
  it("records the session on the queue view (with the count) and on a review page (with the practice and connection)", async () => {
    const { id } = await pending();
    await auditIntegrationViewed(operator, { count: 3 });
    await auditIntegrationViewed(operator, { tenantId: a.tenantId, connectionId: id });

    const review = await audits(id, "operator.integration_viewed");
    expect(review).toHaveLength(1);
    expect(review[0]).toMatchObject({
      actorUserId: operator.userId,
      tenantId: a.tenantId,
      entityType: "integration_connection",
      entityId: id,
    });
    expect(review[0]!.metadata).toEqual({ session_id: operator.sessionId });

    const queue = (
      await systemDb()
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.actorUserId, operator.userId),
            eq(auditEvents.action, "operator.integration_viewed"),
          ),
        )
        .orderBy(asc(auditEvents.id))
    ).filter((event) => event.entityId === null);
    expect(queue.length).toBeGreaterThanOrEqual(1);
    expect(queue.at(-1)).toMatchObject({ tenantId: null, entityType: null });
    expect(queue.at(-1)!.metadata).toEqual({ count: 3, session_id: operator.sessionId });
  });
});

describe("what a practice session can and cannot do (the privileges the operator path stands on)", () => {
  it("a practice administrator cannot approve their own connection: not the columns, not the status", async () => {
    const { id } = await pending();
    await expectDbError(
      withTenant(a, (tx) =>
        tx.execute(sql`
          update integration_connections
          set approved_by = ${a.userId}::uuid, approved_at = now(), approval_method = 'video_call',
              population_scope = 'group_export'
          where id = ${id}::uuid`),
      ),
      /permission denied/,
    );
    await expectDbError(
      withTenant(a, (tx) =>
        tx.execute(sql`update integration_connections set status = 'active' where id = ${id}::uuid`),
      ),
      /only the platform operator may activate a pending connection/,
    );
    expect((await row(id)).status).toBe("pending_approval");
  });

  it("another practice sees nothing of the connection and cannot release its claim", async () => {
    const { id } = await pending(a);
    const seen = await withTenant(b, (tx) =>
      tx
        .select({ id: integrationConnections.id })
        .from(integrationConnections)
        .where(eq(integrationConnections.id, id)),
    );
    expect(seen).toEqual([]);
    const released = await withTenant(b, (tx) =>
      tx.execute<{ released: boolean }>(sql`select integration_registry_release(${id}::uuid) as released`),
    );
    expect(released.rows[0]!.released).toBe(false);
    expect(await registryRows(id)).toHaveLength(1);
  });

  it("the operator's decision is recorded under the practice it concerns, never another's", async () => {
    const mine = await pending(a);
    const theirs = await pending(b);
    await approveConnection(await approvalOf(a, mine.id), operator, OPTS);
    const own = await systemDb()
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.tenantId, a.tenantId), eq(auditEvents.action, "operator.integration_approved")),
      );
    expect(own).toHaveLength(1);
    const other = await systemDb()
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.tenantId, b.tenantId), eq(auditEvents.action, "operator.integration_approved")),
      );
    expect(other).toEqual([]);
    expect((await row(theirs.id)).status).toBe("pending_approval");
  });
});
