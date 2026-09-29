import { randomUUID } from "node:crypto";
import { isValidElement, type ReactElement } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, integrationPayerMappings } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { IntegrationConnectionError, type IntegrationActor } from "@/domain/integrations/connections";
import {
  auditPayerMappingsViewed,
  listMappablePayers,
  listPayerMappings,
  MAX_PAYER_MAPPING_ROWS,
  savePayerMappings,
} from "@/domain/integrations/payer-mappings";
import { en } from "@/i18n/messages/en";
import {
  activeConnectionIn,
  issueRow,
  payerOf,
  practiceWithActiveConnection,
  revokeConnectionOf,
  runningRun,
  syncedPatient,
  type Ctx,
} from "../support/sync-fixtures";
import { createTestTenant } from "./helpers";

// docs/specs/patient-integrations.md PI2b, "Payer mapping page (step-up)": payor keys mapped to the
// practice's payers, tenant-scoped under RLS, saving needs an MFA step-up, every write audited.
// R-7.2.4 (tenant isolation), R-7.2.2 (step-up), R-7.5.1 (audit), CLAUDE.md #9 (no guessed payers).
// Domain and Server Action levels against the real database; only the session, request headers, and
// Next's redirect / notFound / cache are faked.

/** Fault injection: while `action` is set, that audit write throws (after the writes it audits). */
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

type Role = "admin" | "manager" | "specialist" | "compliance";
let auth: { tenantId: string; userId: string; role: Role; mfaVerifiedAt?: Date | null; sessionId?: string };
vi.mock("@/auth/session", () => ({ requireAuth: async () => auth }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "accept-language": "en" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}
class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
  notFound: () => {
    throw new NotFound("not found");
  },
}));

const { savePayerMappingsAction } = await import("@/app/(app)/settings/integrations/[id]/payers/actions");
const { default: PayerMappingPage } = await import("@/app/(app)/settings/integrations/[id]/payers/page");

const admin = (ctx: Ctx, overrides: Partial<IntegrationActor> = {}): IntegrationActor => ({
  ...ctx,
  role: "admin",
  syntheticOnly: false,
  recentMfa: true,
  stepUpVerifiedAt: new Date(Date.now() - 60_000).toISOString(),
  ...overrides,
});

const KEY_A = "Organization/ins-alpha";
const KEY_B = "Organization/ins-beta";

beforeEach(() => {
  auditFailure.action = null;
});
afterAll(() => closeDatabase());

/** A practice with an active connection, a running run, and synced patients under two insurer keys. */
async function practice(counts: { a?: number; b?: number } = { a: 2, b: 1 }) {
  const { ctx, connectionId } = await practiceWithActiveConnection("Payer mapping");
  const runId = await runningRun(ctx, connectionId);
  for (let i = 0; i < (counts.a ?? 0); i++) await syncedPatient(ctx, connectionId, runId, KEY_A);
  for (let i = 0; i < (counts.b ?? 0); i++) await syncedPatient(ctx, connectionId, runId, KEY_B);
  const alpha = await payerOf(ctx, "Synthetic Alpha Health");
  const beta = await payerOf(ctx, "Synthetic Beta Plan");
  return { ctx, connectionId, runId, alpha, beta };
}

/** The connection's mappings, read as its own practice (the tenant policy applies to the read). */
async function mappingRows(ctx: Ctx, connectionId: string) {
  return withTenant(ctx, (tx) =>
    tx
      .select()
      .from(integrationPayerMappings)
      .where(eq(integrationPayerMappings.connectionId, connectionId))
      .orderBy(asc(integrationPayerMappings.payorKey)),
  );
}

async function mappingAudits(connectionId: string) {
  const rows = await systemDb()
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, "integration.payer_mapping_changed"))
    .orderBy(asc(auditEvents.id));
  return rows.filter(
    (event) => event.metadata && (event.metadata as Record<string, unknown>).connection_id === connectionId,
  );
}

const save = (ctx: Ctx, connectionId: string, lines: unknown, actor: IntegrationActor = admin(ctx)) =>
  withTenant(ctx, (tx) => savePayerMappings(tx, actor, connectionId, lines));

const line = (key: string, payerId: string, version = "") => ({ key, payerId, version });

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IntegrationConnectionError) return error;
    throw error;
  }
  throw new Error("Expected an IntegrationConnectionError, but the call succeeded");
}

describe("listing the insurers of a connection", () => {
  it("lists every payor key a synced patient carries with how many patients, and the practice's payers", async () => {
    const { ctx, connectionId, alpha } = await practice({ a: 2, b: 1 });
    const list = await withTenant(ctx, (tx) => listPayerMappings(tx, connectionId));
    expect(list.truncated).toBe(false);
    expect(list.rows).toEqual([
      {
        payorKey: KEY_A,
        payorName: null,
        payerId: null,
        mappingId: null,
        version: "",
        patientCount: 2,
        savable: true,
      },
      {
        payorKey: KEY_B,
        payorName: null,
        payerId: null,
        mappingId: null,
        version: "",
        patientCount: 1,
        savable: true,
      },
    ]);
    const payers = await withTenant(ctx, (tx) => listMappablePayers(tx));
    expect(payers.map((payer) => payer.name)).toEqual(["Synthetic Alpha Health", "Synthetic Beta Plan"]);
    expect(payers.map((payer) => payer.id)).toContain(alpha);
    // Only ids and names: nothing else about a payer is offered.
    expect(Object.keys(payers[0]!).sort()).toEqual(["id", "name"]);
  });

  it("keeps a decision when no patient carries the key any more, and a patient with no coverage adds no row", async () => {
    const { ctx, connectionId, runId, alpha } = await practice({ a: 1, b: 0 });
    await syncedPatient(ctx, connectionId, runId, null);
    await save(ctx, connectionId, [line(KEY_A, alpha)]);
    // The one patient with the key moves off it, as a sync run would change it (the read-only trigger
    // admits a change to a synced patient's coverage only inside a running run of its connection).
    await withTenant(ctx, async (tx) => {
      await tx.execute(sql`select set_config('app.sync_run_id', ${runId}, true)`);
      await tx.execute(sql`select set_config('app.sync_connection_id', ${connectionId}, true)`);
      await tx.execute(
        sql`update patients set coverage_payor_key = null, coverage_status = 'none', member_id_enc = null, member_id_last4 = null
            where source_connection_id = ${connectionId}::uuid and coverage_payor_key = ${KEY_A}`,
      );
    });
    const list = await withTenant(ctx, (tx) => listPayerMappings(tx, connectionId));
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]).toMatchObject({ payorKey: KEY_A, payerId: alpha, patientCount: 0 });
    expect(list.rows[0]!.mappingId).not.toBeNull();
  });

  it("is tenant-scoped: another practice sees no insurers, no mappings, and no payers of this one", async () => {
    const mine = await practice();
    await save(mine.ctx, mine.connectionId, [line(KEY_A, mine.alpha)]);
    const other = await createTestTenant("Payer mapping other");
    const seen = await withTenant(other, (tx) => listPayerMappings(tx, mine.connectionId));
    expect(seen).toEqual({ rows: [], truncated: false });
    expect(await withTenant(other, (tx) => listMappablePayers(tx))).toEqual([]);
    // The rows themselves are invisible to the other practice's role, whatever the query.
    const direct = await withTenant(other, (tx) =>
      tx
        .select({ id: integrationPayerMappings.id })
        .from(integrationPayerMappings)
        .where(eq(integrationPayerMappings.connectionId, mine.connectionId)),
    );
    expect(direct).toEqual([]);
  });
});

describe("saving mappings", () => {
  it("maps an insurer to a payer of the practice: one row, who saved it, one audit event with counts and IDs only", async () => {
    const { ctx, connectionId, alpha } = await practice({ a: 2, b: 1 });
    const stepUpAt = new Date(Date.now() - 30_000).toISOString();
    const sessionId = randomUUID();
    const result = await save(
      ctx,
      connectionId,
      [line(KEY_A, alpha), line(KEY_B, "")],
      admin(ctx, { stepUpVerifiedAt: stepUpAt, sessionId }),
    );
    expect(result).toEqual({ changed: 1 });

    const rows = await mappingRows(ctx, connectionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: ctx.tenantId,
      connectionId,
      payorKey: KEY_A,
      payorName: null,
      payerId: alpha,
      updatedBy: ctx.userId,
    });

    const events = await mappingAudits(connectionId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: ctx.userId,
      tenantId: ctx.tenantId,
      entityType: "integration_payer_mapping",
      entityId: rows[0]!.id,
      // A fixed reason code, never free text.
      reason: "payer_mapping",
    });
    expect(events[0]!.metadata).toEqual({
      connection_id: connectionId,
      payer_id: alpha,
      previous_payer_id: null,
      change: "mapped",
      affected_patient_count: 2,
      step_up_verified_at: stepUpAt,
      session_id: sessionId,
    });
    // Never the insurer key or name, and no patient: the event names the mapping row's own ID.
    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain("Organization/");
    expect(serialized).not.toContain("ins-alpha");
  });

  it("changes and clears a mapping (each its own audit event), and re-saving what is saved writes nothing", async () => {
    const { ctx, connectionId, alpha, beta } = await practice();
    await save(ctx, connectionId, [line(KEY_A, alpha), line(KEY_B, beta)]);
    const first = await mappingRows(ctx, connectionId);
    const version = (key: string) => first.find((row) => row.payorKey === key)!.updatedAt.toISOString();

    // Unchanged lines: nothing written, nothing audited.
    expect(
      await save(ctx, connectionId, [line(KEY_A, alpha, version(KEY_A)), line(KEY_B, beta, version(KEY_B))]),
    ).toEqual({
      changed: 0,
    });
    expect(await mappingAudits(connectionId)).toHaveLength(2);

    // A changed payer and a cleared one, from the version the page showed.
    const result = await save(ctx, connectionId, [
      line(KEY_A, beta, version(KEY_A)),
      line(KEY_B, "", version(KEY_B)),
    ]);
    expect(result).toEqual({ changed: 2 });
    const after = await mappingRows(ctx, connectionId);
    expect(after.find((row) => row.payorKey === KEY_A)!.payerId).toBe(beta);
    // Cleared to "not mapped": the row stays, with no payer (an explicit decision, not a missing one).
    expect(after.find((row) => row.payorKey === KEY_B)).toMatchObject({
      payerId: null,
      updatedBy: ctx.userId,
    });
    expect(after).toHaveLength(2);

    const events = await mappingAudits(connectionId);
    expect(events).toHaveLength(4);
    const byRow = new Map(
      events.slice(2).map((event) => [event.entityId, event.metadata as Record<string, unknown>]),
    );
    expect(byRow.get(first.find((row) => row.payorKey === KEY_A)!.id)).toMatchObject({
      change: "changed",
      previous_payer_id: alpha,
      payer_id: beta,
      affected_patient_count: 2,
    });
    expect(byRow.get(first.find((row) => row.payorKey === KEY_B)!.id)).toMatchObject({
      change: "cleared",
      previous_payer_id: beta,
      payer_id: null,
      affected_patient_count: 1,
    });
  });

  it("leaves an unmapped insurer unmapped without creating a row", async () => {
    const { ctx, connectionId } = await practice();
    expect(await save(ctx, connectionId, [line(KEY_A, ""), line(KEY_B, "")])).toEqual({ changed: 0 });
    expect(await mappingRows(ctx, connectionId)).toEqual([]);
    expect(await mappingAudits(connectionId)).toEqual([]);
  });

  it("refuses a page that went stale: the mapping changed since it was opened, and nothing is saved", async () => {
    const { ctx, connectionId, alpha, beta } = await practice();
    await save(ctx, connectionId, [line(KEY_A, alpha)]);
    const [row] = await mappingRows(ctx, connectionId);
    const opened = row!.updatedAt.toISOString();
    // A second administrator saved a different payer after this page was opened.
    await withTenant(ctx, (tx) =>
      tx.execute(
        sql`update integration_payer_mappings set payer_id = ${beta}::uuid, updated_at = now() + interval '1 second' where id = ${row!.id}::uuid`,
      ),
    );
    const error = await refusal(save(ctx, connectionId, [line(KEY_A, "", opened), line(KEY_B, alpha)]));
    expect(error.message).toBe(en.integrations["error.payersStale"]);
    // Atomic: the fresh line on the other insurer was not saved either.
    expect((await mappingRows(ctx, connectionId)).map((mapping) => mapping.payorKey)).toEqual([KEY_A]);
    expect((await mappingRows(ctx, connectionId))[0]!.payerId).toBe(beta);
    expect(await mappingAudits(connectionId)).toHaveLength(1);
    expect(opened).not.toBe((await mappingRows(ctx, connectionId))[0]!.updatedAt.toISOString());
  });

  it("refuses a line that carries no version for an insurer that already has a decision (version mismatch)", async () => {
    const { ctx, connectionId, alpha, beta } = await practice();
    await save(ctx, connectionId, [line(KEY_B, beta)]);
    const error = await refusal(save(ctx, connectionId, [line(KEY_B, alpha, "")]));
    expect(error.message).toBe(en.integrations["error.payersStale"]);
    expect((await mappingRows(ctx, connectionId))[0]!.payerId).toBe(beta);
  });

  it("refuses an insurer this connection never reported: an administrator can't plant keys", async () => {
    const { ctx, connectionId, alpha } = await practice();
    const error = await refusal(save(ctx, connectionId, [line("Organization/planted", alpha)]));
    expect(error.message).toBe(en.integrations["error.payerKeyUnknown"]);
    expect(await mappingRows(ctx, connectionId)).toEqual([]);
  });

  it("refuses an insurer reported only by another connection of the same practice", async () => {
    // Connection 1 reported KEY_A and KEY_B (and holds a mapping for KEY_B); it is revoked, and the
    // practice connects again: connection 2 reports only KEY_C.
    const first = await practice({ a: 1, b: 1 });
    const KEY_C = "Organization/ins-gamma";
    await save(first.ctx, first.connectionId, [line(KEY_B, first.beta)]);
    await revokeConnectionOf(first.ctx, first.connectionId);
    const secondId = await activeConnectionIn(first.ctx);
    const secondRun = await runningRun(first.ctx, secondId);
    await syncedPatient(first.ctx, secondId, secondRun, KEY_C);

    // Neither a key a patient of connection 1 carries nor a key that only connection 1 has a
    // mapping for is connection 2's to map.
    for (const key of [KEY_A, KEY_B]) {
      const error = await refusal(save(first.ctx, secondId, [line(key, first.alpha)]));
      expect(error.message).toBe(en.integrations["error.payerKeyUnknown"]);
    }
    expect(await mappingRows(first.ctx, secondId)).toEqual([]);
    // Connection 1's own mapping is untouched, and the listing of connection 2 shows only its own key.
    expect((await mappingRows(first.ctx, first.connectionId)).map((row) => row.payorKey)).toEqual([KEY_B]);
    const listed = await withTenant(first.ctx, (tx) => listPayerMappings(tx, secondId));
    expect(listed.rows.map((row) => row.payorKey)).toEqual([KEY_C]);
    // Its own key is accepted (the refusal above is about the key, not the connection).
    expect(await save(first.ctx, secondId, [line(KEY_C, first.alpha)])).toEqual({ changed: 1 });
    expect(await mappingAudits(secondId)).toHaveLength(1);
  });

  it("refuses a payer that isn't the practice's own (another practice's payer, or no payer at all)", async () => {
    const mine = await practice();
    const theirs = await practice();
    for (const payerId of [theirs.alpha, randomUUID()]) {
      const error = await refusal(save(mine.ctx, mine.connectionId, [line(KEY_A, payerId)]));
      expect(error.message).toBe(en.integrations["error.payerUnknown"]);
    }
    expect(await mappingRows(mine.ctx, mine.connectionId)).toEqual([]);
    expect(await mappingRows(theirs.ctx, theirs.connectionId)).toEqual([]);
  });

  it("refuses a connection that is not the practice's: another practice's ID is 'not found', its mappings untouched", async () => {
    const mine = await practice();
    const theirs = await practice();
    await save(theirs.ctx, theirs.connectionId, [line(KEY_A, theirs.alpha)]);
    const before = await mappingRows(theirs.ctx, theirs.connectionId);

    const error = await refusal(save(mine.ctx, theirs.connectionId, [line(KEY_A, mine.alpha)]));
    expect(error.message).toBe(en.integrations["error.notFound"]);
    expect(await mappingRows(theirs.ctx, theirs.connectionId)).toEqual(before);
    expect(await mappingRows(mine.ctx, mine.connectionId)).toEqual([]);
    expect(await mappingAudits(theirs.connectionId)).toHaveLength(1);
    // Nor with a connection that exists nowhere.
    const unknown = await refusal(save(mine.ctx, randomUUID(), [line(KEY_A, mine.alpha)]));
    expect(unknown.message).toBe(en.integrations["error.notFound"]);
  });

  it("refuses a revoked connection: its mappings can no longer change", async () => {
    const { ctx, connectionId, alpha } = await practice();
    await withTenant(ctx, (tx) =>
      tx.execute(
        sql`update integration_connections set status = 'revoked', revoked_by = ${ctx.userId}::uuid, revoked_at = now() where id = ${connectionId}::uuid`,
      ),
    );
    const error = await refusal(save(ctx, connectionId, [line(KEY_A, alpha)]));
    expect(error.message).toBe(en.integrations["error.revoked"]);
    expect(await mappingRows(ctx, connectionId)).toEqual([]);
    // It can still be read (the page shows it read-only).
    expect((await withTenant(ctx, (tx) => listPayerMappings(tx, connectionId))).rows).toHaveLength(2);
  });

  it.each([
    ["not a list", "nope"],
    ["a line that is not an object", ["Organization/x"]],
    ["a missing field", [{ key: KEY_A, payerId: "" }]],
    ["a payer that is not a UUID", [line(KEY_A, "not-a-uuid")]],
    ["a version that is not a timestamp", [line(KEY_A, "", "yesterday")]],
    ["an empty key", [line("", "")]],
    ["a key with a control character", [line(`${KEY_A}\u0000`, "")]],
    ["an over-long key", [line(`Organization/${"x".repeat(300)}`, "")]],
    ["the same insurer twice", [line(KEY_A, ""), line(KEY_A, "")]],
  ])("refuses a malformed form: %s", async (_label, lines) => {
    const { ctx, connectionId } = await practice();
    const error = await refusal(save(ctx, connectionId, lines));
    expect(error.message).toBe(en.integrations["error.unexpectedField"]);
    expect(await mappingRows(ctx, connectionId)).toEqual([]);
  });

  it("refuses more insurers than one save accepts", async () => {
    const { ctx, connectionId } = await practice();
    const lines = Array.from({ length: MAX_PAYER_MAPPING_ROWS + 1 }, (_, i) =>
      line(`Organization/k${i}`, ""),
    );
    const error = await refusal(save(ctx, connectionId, lines));
    expect(error.message).toBe(en.integrations["error.payersTooMany"]);
  });

  it("rolls the whole save back when the audit write fails: no mapping row is left without its event", async () => {
    const { ctx, connectionId, alpha, beta } = await practice();
    auditFailure.action = "integration.payer_mapping_changed";
    await expect(save(ctx, connectionId, [line(KEY_A, alpha), line(KEY_B, beta)])).rejects.toThrow(
      "injected audit failure",
    );
    auditFailure.action = null;
    expect(await mappingRows(ctx, connectionId)).toEqual([]);
    expect(await mappingAudits(connectionId)).toEqual([]);
    expect(await save(ctx, connectionId, [line(KEY_A, alpha), line(KEY_B, beta)])).toEqual({ changed: 2 });
  });
});

describe("who may save (administrator, and a step-up within five minutes)", () => {
  it.each(["manager", "specialist", "compliance"] as const)("refuses a %s, writing nothing", async (role) => {
    const { ctx, connectionId, alpha } = await practice();
    const error = await refusal(save(ctx, connectionId, [line(KEY_A, alpha)], admin(ctx, { role })));
    expect(error.message).toBe(en.integrations["error.notAdmin"]);
    expect(error.stepUpRequired).toBe(false);
    expect(await mappingRows(ctx, connectionId)).toEqual([]);
    expect(await mappingAudits(connectionId)).toEqual([]);
  });

  it.each([
    ["no verification recorded", { recentMfa: undefined }],
    ["an old verification", { recentMfa: false }],
  ])(
    "requires a step-up: %s is refused with the step-up flag, before anything else is checked",
    async (_label, overrides) => {
      const { ctx, connectionId, alpha } = await practice();
      const error = await refusal(save(ctx, connectionId, [line(KEY_A, alpha)], admin(ctx, overrides)));
      expect(error.message).toBe(en.integrations["error.stepUpRequired"]);
      expect(error.stepUpRequired).toBe(true);
      // Not a payer, key, or form error: the step-up comes first, even for a garbage form.
      const garbage = await refusal(save(ctx, connectionId, "garbage", admin(ctx, overrides)));
      expect(garbage.stepUpRequired).toBe(true);
      expect(await mappingRows(ctx, connectionId)).toEqual([]);
      expect(await mappingAudits(connectionId)).toEqual([]);
    },
  );
});

describe("viewing the mapping page is audited (payor keys are Restricted PHI on the patient rows)", () => {
  it("records the connection and counts, never a key", async () => {
    const { ctx, connectionId } = await practice({ a: 2, b: 1 });
    const sessionId = randomUUID();
    await withTenant(ctx, async (tx) => {
      const list = await listPayerMappings(tx, connectionId);
      await auditPayerMappingsViewed(tx, { ...ctx, sessionId }, connectionId, list);
    });
    const events = await systemDb()
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "integration.payer_mappings_viewed"),
          eq(auditEvents.entityId, connectionId),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: ctx.userId,
      tenantId: ctx.tenantId,
      entityType: "integration_connection",
      reason: "payer_mapping",
    });
    expect(events[0]!.metadata).toEqual({ session_id: sessionId, insurer_count: 2, patient_count: 3 });
    expect(JSON.stringify(events[0])).not.toContain("Organization/");
  });
});

// The Server Action and the page, as the browser reaches them.
function form(fields: Array<[string, string]>): FormData {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  return data;
}
const formOf = (id: string, lines: Array<{ key: string; payerId: string; version?: string }>) =>
  form([
    ["id", id],
    ...lines.flatMap(({ key, payerId, version }): Array<[string, string]> => [
      ["key", key],
      ["payer", payerId],
      ["version", version ?? ""],
    ]),
  ]);
/** Runs the action; a redirect (success) comes back as `{ redirectedTo }`. */
async function run(data: FormData) {
  try {
    return { state: await savePayerMappingsAction({}, data) };
  } catch (error) {
    if (error instanceof Redirect) return { redirectedTo: error.to };
    throw error;
  }
}
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

describe("savePayerMappingsAction", () => {
  it("saves for an administrator with a recent verification, and goes back to the page with the count", async () => {
    const { ctx, connectionId, alpha, beta } = await practice();
    auth = { ...ctx, role: "admin", mfaVerifiedAt: minutesAgo(1), sessionId: randomUUID() };
    const result = await run(
      formOf(connectionId, [
        { key: KEY_A, payerId: alpha },
        { key: KEY_B, payerId: beta },
      ]),
    );
    expect(result.redirectedTo).toBe(`/settings/integrations/${connectionId}/payers?saved=2`);
    expect((await mappingRows(ctx, connectionId)).map((row) => row.payerId)).toEqual([alpha, beta]);
    const events = await mappingAudits(connectionId);
    expect(events).toHaveLength(2);
    const metadata = events[0]!.metadata as Record<string, unknown>;
    expect(metadata.step_up_verified_at).toBe(auth.mfaVerifiedAt!.toISOString());
    // The signed-in session, from the session row, never the form.
    expect(metadata.session_id).toBe(auth.sessionId);
    expect(events[0]!.reason).toBe("payer_mapping");
  });

  it.each(["manager", "specialist", "compliance"] as const)(
    "refuses a %s in the action itself, writing nothing",
    async (role) => {
      const { ctx, connectionId, alpha } = await practice();
      auth = { ...ctx, role, mfaVerifiedAt: minutesAgo(1) };
      const result = await run(formOf(connectionId, [{ key: KEY_A, payerId: alpha }]));
      expect(result.state?.error).toBe(en.integrations["error.notAdmin"]);
      expect(await mappingRows(ctx, connectionId)).toEqual([]);
    },
  );

  it.each([
    ["no verification on the session", null],
    ["a verification six minutes old", minutesAgo(6)],
    ["a verification from the future beyond clock skew", new Date(Date.now() + 5 * 60_000)],
  ])(
    "needs a step-up: %s is refused with the link's flag and nothing is saved",
    async (_label, mfaVerifiedAt) => {
      const { ctx, connectionId, alpha } = await practice();
      auth = { ...ctx, role: "admin", mfaVerifiedAt };
      const result = await run(formOf(connectionId, [{ key: KEY_A, payerId: alpha }]));
      expect(result.state).toEqual({ error: en.integrations["error.stepUpRequired"], stepUpRequired: true });
      expect(await mappingRows(ctx, connectionId)).toEqual([]);
      expect(await mappingAudits(connectionId)).toEqual([]);
    },
  );

  it("accepts a verification just inside the five-minute window", async () => {
    const { ctx, connectionId, alpha } = await practice();
    auth = { ...ctx, role: "admin", mfaVerifiedAt: new Date(Date.now() - (5 * 60_000 - 5_000)) };
    const result = await run(formOf(connectionId, [{ key: KEY_A, payerId: alpha }]));
    expect(result.redirectedTo).toContain("?saved=1");
  });

  it("takes the practice from the session, never the form: another practice's connection is not found", async () => {
    const mine = await practice();
    const theirs = await practice();
    auth = { ...mine.ctx, role: "admin", mfaVerifiedAt: minutesAgo(1) };
    const result = await run(
      form([
        ["id", theirs.connectionId],
        ["tenantId", theirs.ctx.tenantId],
        ["key", KEY_A],
        ["payer", mine.alpha],
        ["version", ""],
      ]),
    );
    expect(result.state?.error).toBe(en.integrations["error.notFound"]);
    expect(await mappingRows(theirs.ctx, theirs.connectionId)).toEqual([]);
    expect(await mappingRows(mine.ctx, mine.connectionId)).toEqual([]);
  });

  it.each([
    [
      "an id that is not a UUID",
      () => formOf("nope", [{ key: KEY_A, payerId: "" }]),
      en.integrations["error.notFound"],
    ],
    [
      "lists of different lengths",
      (id: string) =>
        form([
          ["id", id],
          ["key", KEY_A],
          ["key", KEY_B],
          ["payer", ""],
          ["version", ""],
        ]),
      en.integrations["error.unexpectedField"],
    ],
    [
      "a file where a value belongs",
      (id: string) => {
        const data = form([
          ["id", id],
          ["key", KEY_A],
          ["version", ""],
        ]);
        data.append("payer", new File(["x"], "x.txt"));
        return data;
      },
      en.integrations["error.unexpectedField"],
    ],
  ])("refuses a malformed request: %s", async (_label, build, message) => {
    const { ctx, connectionId } = await practice();
    auth = { ...ctx, role: "admin", mfaVerifiedAt: minutesAgo(1) };
    const result = await run(build(connectionId));
    expect(result.state?.error).toBe(message);
    expect(await mappingRows(ctx, connectionId)).toEqual([]);
  });
});

describe("the payer mapping page", () => {
  const params = (id: string) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });

  it("is administrators only: any other role, and any invalid or foreign connection, is a 404 and audits nothing", async () => {
    const mine = await practice();
    const theirs = await practice();
    for (const role of ["manager", "specialist", "compliance"] as const) {
      auth = { ...mine.ctx, role, mfaVerifiedAt: minutesAgo(1) };
      await expect(PayerMappingPage(params(mine.connectionId))).rejects.toBeInstanceOf(NotFound);
    }
    auth = { ...mine.ctx, role: "admin", mfaVerifiedAt: minutesAgo(1) };
    await expect(PayerMappingPage(params("not-a-uuid"))).rejects.toBeInstanceOf(NotFound);
    await expect(PayerMappingPage(params(theirs.connectionId))).rejects.toBeInstanceOf(NotFound);
    await expect(PayerMappingPage(params(randomUUID()))).rejects.toBeInstanceOf(NotFound);
    const events = await systemDb()
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "integration.payer_mappings_viewed"),
          eq(auditEvents.tenantId, mine.ctx.tenantId),
        ),
      );
    expect(events).toEqual([]);
  });

  it("renders for an administrator and audits the view once", async () => {
    const { ctx, connectionId, runId, alpha } = await practice();
    await issueRow(ctx, runId, "needs_review", null);
    auth = { ...ctx, role: "admin", mfaVerifiedAt: minutesAgo(1), sessionId: randomUUID() };
    const element = await PayerMappingPage(params(connectionId));
    expect(element).toBeTruthy();
    const events = await systemDb()
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "integration.payer_mappings_viewed"),
          eq(auditEvents.entityId, connectionId),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata).toEqual({
      session_id: auth.sessionId,
      insurer_count: 2,
      patient_count: 3,
    });
    expect(events[0]!.reason).toBe("payer_mapping");
    expect(alpha).toBeTruthy();
  });
});

/** Every element in a tree (the page's own JSX, before any component runs) whose props satisfy `match`. */
function findElements(
  node: unknown,
  match: (props: Record<string, unknown>) => boolean,
  found: ReactElement<Record<string, unknown>>[] = [],
): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, match, found);
  } else if (isValidElement<Record<string, unknown>>(node)) {
    if (match(node.props)) found.push(node);
    for (const value of Object.values(node.props)) findElements(value, match, found);
  }
  return found;
}
function textOf(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string" || typeof node === "number") out.push(String(node));
  else if (Array.isArray(node)) for (const child of node) textOf(child, out);
  else if (isValidElement<Record<string, unknown>>(node)) {
    for (const [name, value] of Object.entries(node.props)) {
      if (name !== "className") textOf(value, out);
    }
  }
  return out;
}
const pageParams = (id: string) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });

describe("counts, and insurers the page can't take", () => {
  it("counts live patients only, yet lists a key that only inactive, merged, or gone patients carry", async () => {
    const { ctx, connectionId, runId, alpha } = await practice({ a: 0, b: 0 });
    await syncedPatient(ctx, connectionId, runId, KEY_A);
    await syncedPatient(ctx, connectionId, runId, KEY_A, "merged");
    await syncedPatient(ctx, connectionId, runId, KEY_A, "inactive");
    await syncedPatient(ctx, connectionId, runId, KEY_B, "gone");
    const list = await withTenant(ctx, (tx) => listPayerMappings(tx, connectionId));
    expect(list.rows.map((row) => [row.payorKey, row.patientCount])).toEqual([
      [KEY_A, 1],
      [KEY_B, 0],
    ]);
    // Any stored key was reported, so both can be mapped; the audit counts live patients, as the page does.
    expect(await save(ctx, connectionId, [line(KEY_A, alpha), line(KEY_B, alpha)])).toEqual({ changed: 2 });
    const counts = (await mappingAudits(connectionId)).map(
      (event) => (event.metadata as Record<string, unknown>).affected_patient_count,
    );
    expect(counts.sort()).toEqual([0, 1]);
  });

  it("lists at most 500 insurers and says when there are more (and not at exactly 500)", async () => {
    const insert = (ctx: Ctx, connectionId: string, count: number) =>
      withTenant(ctx, (tx) =>
        tx.insert(integrationPayerMappings).values(
          Array.from({ length: count }, (_, i) => ({
            tenantId: ctx.tenantId,
            connectionId,
            payorKey: `Organization/k${String(i).padStart(4, "0")}`,
            payerId: null,
            updatedBy: ctx.userId,
          })),
        ),
      );
    const over = await practice({ a: 0, b: 0 });
    await insert(over.ctx, over.connectionId, MAX_PAYER_MAPPING_ROWS + 1);
    const listed = await withTenant(over.ctx, (tx) => listPayerMappings(tx, over.connectionId));
    expect(listed.truncated).toBe(true);
    expect(listed.rows).toHaveLength(MAX_PAYER_MAPPING_ROWS);
    expect(listed.rows[0]!.payorKey).toBe("Organization/k0000");
    expect(listed.rows.at(-1)!.payorKey).toBe(
      `Organization/k${String(MAX_PAYER_MAPPING_ROWS - 1).padStart(4, "0")}`,
    );

    const exact = await practice({ a: 0, b: 0 });
    await insert(exact.ctx, exact.connectionId, MAX_PAYER_MAPPING_ROWS);
    const full = await withTenant(exact.ctx, (tx) => listPayerMappings(tx, exact.connectionId));
    expect(full.truncated).toBe(false);
    expect(full.rows).toHaveLength(MAX_PAYER_MAPPING_ROWS);
  });

  it("a stored key a save would refuse doesn't block the form: it is listed read-only, the others still save", async () => {
    const { ctx, connectionId, alpha } = await practice({ a: 1, b: 0 });
    const tooLong = `Organization/${"x".repeat(300)}`;
    const hidden = "Organization/zero\u200bwidth";
    await withTenant(ctx, (tx) =>
      tx.insert(integrationPayerMappings).values(
        [tooLong, hidden].map((payorKey) => ({
          tenantId: ctx.tenantId,
          connectionId,
          payorKey,
          payerId: null,
          updatedBy: ctx.userId,
        })),
      ),
    );
    const list = await withTenant(ctx, (tx) => listPayerMappings(tx, connectionId));
    const savable = new Map(list.rows.map((row) => [row.payorKey, row.savable]));
    expect(savable.get(KEY_A)).toBe(true);
    expect(savable.get(tooLong)).toBe(false);
    expect(savable.get(hidden)).toBe(false);

    // The page shows them read-only, marked, cut, and never as form fields.
    auth = { ...ctx, role: "admin", mfaVerifiedAt: minutesAgo(1), sessionId: randomUUID() };
    const page = await PayerMappingPage(pageParams(connectionId));
    const [form] = findElements(page, (props) => Array.isArray(props.rows) && "needsStepUp" in props);
    const rows = form!.props.rows as Array<{ payorKey: string; savable: boolean; displayKey: string }>;
    const shown = new Map(rows.map((row) => [row.payorKey, row]));
    expect(shown.get(tooLong)!.savable).toBe(false);
    expect(shown.get(tooLong)!.displayKey.length).toBeLessThanOrEqual(81);
    expect(shown.get(hidden)!.displayKey).not.toContain("\u200b");
    expect(shown.get(hidden)!.displayKey).toContain("\ufffd");

    // The rest of the form saves; a hand-built line for an unsavable key is still refused.
    expect(await save(ctx, connectionId, [line(KEY_A, alpha)])).toEqual({ changed: 1 });
    const error = await refusal(save(ctx, connectionId, [line(tooLong, alpha)]));
    expect(error.message).toBe(en.integrations["error.unexpectedField"]);
  });
});

describe("two saves at once, and the version a page carries", () => {
  it("two saves giving the same new insurer a first decision: one wins, the other is stale (conflict does nothing)", async () => {
    const { ctx, connectionId, alpha, beta } = await practice();
    const results = await Promise.allSettled([
      save(ctx, connectionId, [line(KEY_A, alpha)]),
      save(ctx, connectionId, [line(KEY_A, beta)]),
    ]);
    const lost = results.filter((result) => result.status === "rejected");
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const reason = (lost[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(IntegrationConnectionError);
    expect((reason as Error).message).toBe(en.integrations["error.payersStale"]);
    // One row, one audit event: the loser wrote and audited nothing.
    expect(await mappingRows(ctx, connectionId)).toHaveLength(1);
    expect(await mappingAudits(connectionId)).toHaveLength(1);
  });

  it("the action takes the version the page showed: a save from a current page works, from an older one is stale", async () => {
    const { ctx, connectionId, alpha, beta } = await practice();
    auth = { ...ctx, role: "admin", mfaVerifiedAt: minutesAgo(1), sessionId: randomUUID() };
    await run(formOf(connectionId, [{ key: KEY_A, payerId: alpha }]));

    // What the page would now carry for the insurer.
    const listed = await withTenant(ctx, (tx) => listPayerMappings(tx, connectionId));
    const opened = listed.rows.find((row) => row.payorKey === KEY_A)!;
    expect(opened.version).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const changed = await run(formOf(connectionId, [{ key: KEY_A, payerId: beta, version: opened.version }]));
    expect(changed.redirectedTo).toContain("?saved=1");
    expect((await mappingRows(ctx, connectionId))[0]!.payerId).toBe(beta);

    // A second administrator's page, opened before that change, is refused and changes nothing.
    const older = await run(formOf(connectionId, [{ key: KEY_A, payerId: alpha, version: opened.version }]));
    expect(older.state?.error).toBe(en.integrations["error.payersStale"]);
    expect((await mappingRows(ctx, connectionId))[0]!.payerId).toBe(beta);
  });
});

describe("the payer mapping page for a revoked connection", () => {
  it("renders read-only with a note: no Save, the selects disabled, and no way to submit a change", async () => {
    const { ctx, connectionId } = await practice();
    await revokeConnectionOf(ctx, connectionId);
    auth = { ...ctx, role: "admin", mfaVerifiedAt: minutesAgo(1), sessionId: randomUUID() };
    const page = await PayerMappingPage(pageParams(connectionId));
    expect(textOf(page).join(" | ")).toContain(en.integrations["payers.revokedNotice"]);
    const [form] = findElements(page, (props) => Array.isArray(props.rows) && "needsStepUp" in props);
    expect(form!.props.readOnly).toBe(true);
    expect((form!.props.rows as unknown[]).length).toBe(2);
    // And the server refuses the save all the same.
    const result = await run(formOf(connectionId, [{ key: KEY_A, payerId: randomUUID() }]));
    expect(result.state?.error).toBeTruthy();
    expect(await mappingRows(ctx, connectionId)).toEqual([]);
  });

  it("an active connection renders editable", async () => {
    const { ctx, connectionId } = await practice();
    auth = { ...ctx, role: "admin", mfaVerifiedAt: minutesAgo(1), sessionId: randomUUID() };
    const page = await PayerMappingPage(pageParams(connectionId));
    const [form] = findElements(page, (props) => Array.isArray(props.rows) && "needsStepUp" in props);
    expect(form!.props.readOnly).toBe(false);
    expect(form!.props.needsStepUp).toBe(false);
  });
});
