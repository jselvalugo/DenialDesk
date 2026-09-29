import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { verifyPassword } from "@/auth/password";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, memberships, sessions, users } from "@/db/schema";
import { withTenant, withTenantAsSystem } from "@/db/tenant";
import {
  IntegrationConnectionError,
  pauseConnection,
  resolveSigningKid,
  resumeConnection,
  revokeConnection,
} from "@/domain/integrations/connections";
import { INTEGRATION_SERVICE_PRINCIPAL_ID } from "@/domain/integrations/principal";
import { testConnection } from "@/domain/integrations/test-connection";
import {
  activeSandbox,
  adminActor,
  connectionRow,
  harness,
  queueRun,
  runnerFor,
  runRow,
  runSync,
  stampOf,
  type Ctx,
} from "../support/sandbox-sync";
import { createTestTenant, expectDbError } from "./helpers";

// docs/specs/patient-integrations.md PI2b, drizzle/0043: the lifecycle trigger stamps every status
// change with the database's real clock; pause and error abandon queued and running runs (revoke
// already did); the integration service principal; `withTenantAsSystem`. R-7.2.4, R-7.5.1.

let ctx: Ctx;
beforeEach(async () => {
  ctx = await createTestTenant("Sync db");
});
afterAll(() => closeDatabase());

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function refusal(promise: Promise<unknown>): Promise<IntegrationConnectionError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IntegrationConnectionError) return error;
    throw error;
  }
  throw new Error("Expected an IntegrationConnectionError, but the call succeeded");
}

describe("the lifecycle trigger stamps status changes with the database's clock (0043)", () => {
  it.each(["paused", "error"] as const)(
    "a change to %s carries the real time whatever the writer wrote",
    async (next) => {
      const h = harness();
      const id = await activeSandbox(ctx, h);
      const before = Date.now();
      await withTenant(ctx, (tx) =>
        tx.execute(sql`
        update integration_connections
        set status = ${next}::integration_connection_status, status_reason = ${next === "error" ? "auth_refused" : null},
            updated_at = '2001-01-01T00:00:00Z'
        where id = ${id}::uuid
      `),
      );
      const { updatedAt } = await connectionRow(id);
      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before - 5_000);
      expect(updatedAt.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
    },
  );

  it("leaves updated_at alone when the status isn't what changed", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    await withTenant(ctx, (tx) =>
      tx.execute(
        sql`update integration_connections set display_name = 'Renamed', updated_at = '2001-01-01T00:00:00Z' where id = ${id}::uuid`,
      ),
    );
    expect((await connectionRow(id)).updatedAt).toEqual(new Date("2001-01-01T00:00:00Z"));
  });

  it("an error set inside a transaction that started before a pass was recorded is not cleared by that pass", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    await withTenant(ctx, async (tx) => {
      // This transaction has started: its `now()` is fixed from here. A passing Test connection is then
      // recorded, in a transaction of its own, and only afterwards does this one move the connection into
      // `error` with `updated_at = now()`, which on its own would be *before* that pass.
      await tx.execute(sql`select 1`);
      await sleep(30);
      expect((await testConnection(runnerFor(ctx), adminActor(ctx), id, h.deps)).outcome).toBe("ok");
      await sleep(30);
      await tx.execute(
        sql`update integration_connections set status = 'error', status_reason = 'auth_refused', updated_at = now() where id = ${id}::uuid`,
      );
    });

    const [pass] = await systemDb()
      .select({ occurredAt: auditEvents.occurredAt })
      .from(auditEvents)
      .where(and(eq(auditEvents.entityId, id), eq(auditEvents.action, "integration.connection_tested")))
      .orderBy(desc(auditEvents.id))
      .limit(1);
    const stored = await connectionRow(id);
    expect(stored.status).toBe("error");
    // The stamp is the moment of the change, after the pass.
    expect(stored.updatedAt.getTime()).toBeGreaterThan(pass!.occurredAt.getTime());

    // So Resume asks for a pass newer than the error: the one recorded before it doesn't count.
    const resume = async () =>
      withTenant(ctx, async (tx) =>
        resumeConnection(
          tx,
          adminActor(ctx),
          id,
          await stampOf(ctx, id),
          undefined,
          await resolveSigningKid(h.deps, id),
        ),
      );
    expect((await refusal(resume())).message).toMatch(/Run Test connection and get a pass before resuming/);
    expect((await connectionRow(id)).status).toBe("error");

    expect((await testConnection(runnerFor(ctx), adminActor(ctx), id, h.deps)).outcome).toBe("ok");
    await resume();
    expect(await connectionRow(id)).toMatchObject({ status: "active", statusReason: null });
  });
});

describe("pause and error abandon queued and running runs (0043), as revoke does", () => {
  async function withRun(state: "queued" | "running") {
    const c = await createTestTenant("Sync db abandon");
    const h = harness();
    const id = await activeSandbox(c, h);
    const runId = await queueRun(c, id);
    if (state === "running") {
      await systemDb().execute(
        sql`update integration_sync_runs set status = 'running', started_at = now(), heartbeat_at = now() where id = ${runId}::uuid`,
      );
    }
    return { c, id, runId };
  }

  it.each(["queued", "running"] as const)("Pause abandons a %s run, stamping when", async (state) => {
    const { c, id, runId } = await withRun(state);
    await withTenant(c, async (tx) => pauseConnection(tx, adminActor(c), id, await stampOf(c, id)));
    const run = await runRow(runId);
    expect(run.status).toBe("abandoned");
    expect(run.finishedAt).not.toBeNull();
    expect((await connectionRow(id)).status).toBe("paused");
  });

  it.each(["queued", "running"] as const)("a move into error abandons a %s run", async (state) => {
    const { c, id, runId } = await withRun(state);
    await withTenant(c, (tx) =>
      tx.execute(
        sql`update integration_connections set status = 'error', status_reason = 'auth_refused' where id = ${id}::uuid`,
      ),
    );
    expect((await runRow(runId)).status).toBe("abandoned");
  });

  it.each(["queued", "running"] as const)("revoking still abandons a %s run", async (state) => {
    const { c, id, runId } = await withRun(state);
    await withTenant(c, async (tx) =>
      revokeConnection(tx, adminActor(c), id, await stampOf(c, id), "no_longer_used"),
    );
    expect((await runRow(runId)).status).toBe("abandoned");
  });

  it("leaves a finished run alone, and another practice's runs alone", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const { runId: finished } = await runSync(ctx, id, h);
    expect((await runRow(finished)).status).toBe("succeeded");
    const bystander = await withRun("queued");
    await withTenant(ctx, async (tx) => pauseConnection(tx, adminActor(ctx), id, await stampOf(ctx, id)));
    expect((await runRow(finished)).status).toBe("succeeded");
    expect((await runRow(bystander.runId)).status).toBe("queued");
  });

  it("a status change that isn't a move away from active abandons nothing", async () => {
    const { c, id, runId } = await withRun("queued");
    // A rename is not a status change; the queued run stays.
    await withTenant(c, (tx) =>
      tx.execute(sql`update integration_connections set display_name = 'Renamed' where id = ${id}::uuid`),
    );
    expect((await runRow(runId)).status).toBe("queued");
  });
});

describe("the integration service principal (0043)", () => {
  it("is a fixed users row that cannot sign in, has no membership, no session and no second factor", async () => {
    const [principal] = await systemDb()
      .select()
      .from(users)
      .where(eq(users.id, INTEGRATION_SERVICE_PRINCIPAL_ID));
    expect(principal).toBeDefined();
    expect(principal!.email).toMatch(/@service\.denialdesk\.invalid$/);
    expect(principal!.disabledAt).not.toBeNull();
    expect(principal!.totpSecretEnc).toBeNull();
    expect(principal!.mfaEnrolledAt).toBeNull();
    expect(principal!.mustChangePassword).toBe(false);
    // Not a hash `verifyPassword` accepts: no password, including the empty one, matches it.
    expect(principal!.passwordHash).not.toMatch(/^scrypt\$/);
    for (const attempt of ["", "!", "password", principal!.passwordHash]) {
      expect(await verifyPassword(attempt, principal!.passwordHash)).toBe(false);
    }
    expect(
      await systemDb()
        .select()
        .from(memberships)
        .where(eq(memberships.userId, INTEGRATION_SERVICE_PRINCIPAL_ID)),
    ).toEqual([]);
    expect(
      await systemDb().select().from(sessions).where(eq(sessions.userId, INTEGRATION_SERVICE_PRINCIPAL_ID)),
    ).toEqual([]);
  });

  it("is the one row the migration seeds, under the constant the code uses", async () => {
    expect(INTEGRATION_SERVICE_PRINCIPAL_ID).toBe("d3a7c0de-5a1c-4e11-8a0c-0000000d0d01");
    const seeded = await systemDb().execute<{ n: string }>(
      sql`select count(*) as n from users where email like '%@service.denialdesk.invalid'`,
    );
    expect(seeded.rows[0]!.n).toBe("1");
  });

  it("stays a real foreign-key target: the sync's writes name it, and a made-up user is refused", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    await runSync(ctx, id, h);
    expect((await connectionRow(id)).updatedBy).toBe(INTEGRATION_SERVICE_PRINCIPAL_ID);
    await expectDbError(
      withTenant(ctx, (tx) =>
        tx.execute(
          sql`update integration_connections set updated_by = ${randomUUID()}::uuid where id = ${id}::uuid`,
        ),
      ),
      /23503/,
    );
  });
});

describe("withTenantAsSystem", () => {
  async function queuedRun(c: Ctx = ctx) {
    const h = harness();
    const id = await activeSandbox(c, h);
    return { id, runId: await queueRun(c, id) };
  }

  it("runs as denialdesk_app with the tenant, the service principal, and the run and connection, transaction-local", async () => {
    const { id, runId } = await queuedRun();
    const seen = await withTenantAsSystem(ctx.tenantId, runId, async (tx, run) => {
      const result = await tx.execute<Record<string, string>>(sql`
        select current_user as role,
               current_setting('app.tenant_id') as tenant,
               current_setting('app.user_id') as actor,
               current_setting('app.sync_run_id') as run,
               current_setting('app.sync_connection_id') as connection
      `);
      return { row: result.rows[0]!, run };
    });
    expect(seen.row).toEqual({
      role: "denialdesk_app",
      tenant: ctx.tenantId,
      actor: INTEGRATION_SERVICE_PRINCIPAL_ID,
      run: runId,
      connection: id,
    });
    expect(seen.run).toEqual({ runId, connectionId: id });

    // Nothing is left on the pooled connection for the next request to inherit (`is_local = true`).
    for (let i = 0; i < 12; i += 1) {
      const after = await systemDb().execute<{
        run: string | null;
        connection: string | null;
        tenant: string | null;
      }>(sql`
        select nullif(current_setting('app.sync_run_id', true), '') as run,
               nullif(current_setting('app.sync_connection_id', true), '') as connection,
               nullif(current_setting('app.tenant_id', true), '') as tenant
      `);
      expect(after.rows[0]).toEqual({ run: null, connection: null, tenant: null });
    }
  });

  it("is subject to row-level security like any practice session: it sees and writes only its own practice", async () => {
    const { runId } = await queuedRun();
    const other = await createTestTenant("Sync db stranger");
    const stranger = await queuedRun(other);
    const visible = await withTenantAsSystem(ctx.tenantId, runId, (tx) =>
      tx.execute<{ id: string }>(sql`select id from integration_sync_runs`),
    );
    expect(visible.rows.map((row) => row.id)).toEqual([runId]);
    await expectDbError(
      withTenantAsSystem(ctx.tenantId, runId, (tx) =>
        tx.execute(sql`
          insert into patients (tenant_id, mrn, first_name, last_name, birth_date, member_id_enc, member_id_last4)
          values (${other.tenantId}::uuid, 'SYN-X', 'Cross', 'Tenant', '1990-01-01', 'x', 'x')
        `),
      ),
      /row-level security/,
    );
    // It can't open another practice's run, nor a made-up one.
    await expect(withTenantAsSystem(ctx.tenantId, stranger.runId, async () => "never")).rejects.toThrow(
      /no such run/,
    );
    await expect(withTenantAsSystem(ctx.tenantId, randomUUID(), async () => "never")).rejects.toThrow(
      /no such run/,
    );
    await expect(withTenantAsSystem("nope", runId, async () => "never")).rejects.toThrow(/UUID/);
    await expect(withTenantAsSystem(ctx.tenantId, "nope", async () => "never")).rejects.toThrow(/UUID/);
  });

  it("only lets the read-only trigger accept a synced row while its run is running", async () => {
    const { runId } = await queuedRun();
    const insertSynced = (
      tx: Parameters<Parameters<typeof withTenantAsSystem>[2]>[0],
      connectionId: string,
    ) =>
      tx.execute(sql`
        insert into patients (tenant_id, mrn, first_name, last_name, birth_date, source, source_connection_id, external_id)
        values (${ctx.tenantId}::uuid, 'SYN-9000001', 'Fhira', 'Testpatient', '1990-01-01', 'fhir', ${connectionId}::uuid, 'syn-x')
      `);
    // Queued, not running: refused.
    await expectDbError(
      withTenantAsSystem(ctx.tenantId, runId, (tx, run) => insertSynced(tx, run.connectionId)),
      /synced row can only be inserted/,
    );
    // Running: accepted.
    await systemDb().execute(
      sql`update integration_sync_runs set status = 'running', started_at = now() where id = ${runId}::uuid`,
    );
    await withTenantAsSystem(ctx.tenantId, runId, (tx, run) => insertSynced(tx, run.connectionId));
    const stored = await systemDb().execute<{ n: string }>(
      sql`select count(*) as n from patients where tenant_id = ${ctx.tenantId}::uuid and external_id = 'syn-x'`,
    );
    expect(stored.rows[0]!.n).toBe("1");
  });

  it("a session without a run can't write a synced row at all (the settings are only set by withTenantAsSystem)", async () => {
    const { id } = await queuedRun();
    await expectDbError(
      withTenant(ctx, (tx) =>
        tx.execute(sql`
          insert into patients (tenant_id, mrn, first_name, last_name, birth_date, source, source_connection_id, external_id)
          values (${ctx.tenantId}::uuid, 'SYN-9000002', 'Fhira', 'Testpatient', '1990-01-01', 'fhir', ${id}::uuid, 'syn-y')
        `),
      ),
      /synced row can only be inserted/,
    );
  });
});
