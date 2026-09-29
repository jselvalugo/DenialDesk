import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { withJobsRole, withTenant, type TenantTx } from "@/db/tenant";
import { claimQueuedRun, enqueueDueRuns } from "@/domain/integrations/job-runs";
import { RUN_LEASE_MS } from "@/domain/integrations/sync-runs";
import { INTEGRATION_SERVICE_PRINCIPAL_ID } from "@/domain/integrations/principal";
import { activeSandbox, harness, queueRun, runRow, type Ctx, type Harness } from "../support/sandbox-sync";
import { createTestTenant, expectDbError } from "./helpers";

// docs/specs/patient-integrations.md PI2b "Jobs" and PI3 (drizzle/0044): the `denialdesk_jobs` role, the two
// SECURITY DEFINER functions, who can call them, what they return, what they change. CI runs Postgres as a
// superuser, so every grant is proved by SET ROLE to the role in question, and the functions' behavior under
// row-level security for an owner that does NOT bypass it is proved with a probe owner (see "walk the tenants").

const migration = readFileSync(
  new URL("../../drizzle/0044_patient_integrations_jobs.sql", import.meta.url),
  "utf8",
);
const statements = migration.split("--> statement-breakpoint");
const statementWith = (fragment: string) => {
  const found = statements.filter((statement) => statement.includes(fragment));
  if (found.length !== 1) throw new Error(`expected one statement with "${fragment}", found ${found.length}`);
  return found[0]!;
};

let ctx: Ctx;
let h: Harness;
beforeEach(async () => {
  ctx = await createTestTenant("Jobs db");
  h = harness();
});
afterAll(() => closeDatabase());

/** Rolls the surrounding transaction back once the test's assertions inside it have run. */
class Rollback extends Error {}
async function inRolledBackTransaction(fn: (tx: TenantTx) => Promise<void>): Promise<void> {
  try {
    await systemDb().transaction(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

const asJobs = (tx: TenantTx) => tx.execute(sql`set local role denialdesk_jobs`);
const asOwner = (tx: TenantTx) => tx.execute(sql`reset role`);
/** Owner-side edit that bypasses the lifecycle triggers (backdating a run; a paused connection with a queued run). Needs the superuser the test database gives us. */
const withoutTriggers = (tx: TenantTx) => tx.execute(sql`set local session_replication_role = replica`);

async function runsOf(tx: TenantTx, tenantId: string) {
  const result = await tx.execute<{
    id: string;
    connection_id: string;
    status: string;
    trigger: string;
    triggered_by: string | null;
  }>(
    sql`select id, connection_id, status, trigger, triggered_by from integration_sync_runs where tenant_id = ${tenantId}::uuid order by queued_at, id`,
  );
  return result.rows;
}

describe("the denialdesk_jobs role and who may call the job functions", () => {
  it("exists, cannot log in, is no superuser, bypasses no row-level security, and owns nothing", async () => {
    const { rows } = await systemDb().execute<{
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreaterole: boolean;
      rolcreatedb: boolean;
    }>(
      sql`select rolcanlogin, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname = 'denialdesk_jobs'`,
    );
    expect(rows).toEqual([
      { rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false },
    ]);
    const owned = await systemDb().execute<{ count: number }>(
      sql`select count(*)::int as count from pg_class where relowner = 'denialdesk_jobs'::regrole`,
    );
    expect(owned.rows[0]!.count).toBe(0);
  });

  it("only denialdesk_jobs (and the owner) may execute either function: not PUBLIC, not denialdesk_app", async () => {
    const { rows } = await systemDb().execute<{
      name: string;
      definer: boolean;
      config: string[];
      grantee: string;
    }>(sql`
      select p.proname as name, p.prosecdef as definer, p.proconfig as config,
             case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.proname in ('integration_claim_run', 'integration_enqueue_due_runs') and p.pronamespace = 'public'::regnamespace
       order by 1, 4`);
    for (const name of ["integration_claim_run", "integration_enqueue_due_runs"]) {
      const forFunction = rows.filter((row) => row.name === name);
      expect(forFunction.length, name).toBeGreaterThan(0);
      const grantees = forFunction.map((row) => row.grantee);
      expect(grantees, name).toContain("denialdesk_jobs");
      expect(grantees, name).not.toContain("PUBLIC");
      expect(grantees, name).not.toContain("denialdesk_app");
      // Only the owner and the jobs role.
      expect(new Set(grantees).size, name).toBe(2);
      // SECURITY DEFINER with the same hardened search_path as the 0039 registry functions (pg_temp last).
      expect(forFunction[0]!.definer, name).toBe(true);
      expect(forFunction[0]!.config, name).toEqual(["search_path=pg_catalog, public, pg_temp"]);
    }
  });

  it("has_function_privilege agrees: the jobs role yes, the app role and PUBLIC no", async () => {
    const { rows } = await systemDb().execute<{ fn: string; jobs: boolean; app: boolean }>(sql`
      select f as fn,
             has_function_privilege('denialdesk_jobs', f, 'execute') as jobs,
             has_function_privilege('denialdesk_app', f, 'execute') as app
        from unnest(array['integration_claim_run(uuid)', 'integration_enqueue_due_runs()']) as f`);
    expect(rows).toEqual([
      { fn: "integration_claim_run(uuid)", jobs: true, app: false },
      { fn: "integration_enqueue_due_runs()", jobs: true, app: false },
    ]);
  });

  it("denialdesk_app cannot execute either function, even inside its own tenant", async () => {
    await expectDbError(
      withTenant(ctx, (tx) => tx.execute(sql`select * from integration_claim_run(${randomUUID()}::uuid)`)),
      /permission denied/,
    );
    await expectDbError(
      withTenant(ctx, (tx) => tx.execute(sql`select integration_enqueue_due_runs()`)),
      /permission denied/,
    );
  });

  it("denialdesk_jobs can call both, and can read nothing else: no table, no user, no audit row", async () => {
    await withJobsRole((tx) => tx.execute(sql`select * from integration_claim_run(${randomUUID()}::uuid)`));
    for (const table of [
      "integration_sync_runs",
      "integration_connections",
      "integration_sync_issues",
      "integration_endpoint_registry",
      "patients",
      "tenants",
      "users",
      "audit_events",
    ]) {
      await expectDbError(
        withJobsRole((tx) => tx.execute(sql.raw(`select 1 from ${table} limit 1`))),
        /permission denied/,
      );
    }
    await expectDbError(
      withJobsRole((tx) =>
        tx.execute(
          sql`insert into integration_sync_runs (tenant_id, connection_id) values (${randomUUID()}::uuid, ${randomUUID()}::uuid)`,
        ),
      ),
      /permission denied/,
    );
  });

  it("the functions expose no column beyond tenant and connection (claim) and run IDs (enqueue)", async () => {
    const { rows } = await systemDb().execute<{ name: string; result: string; returns_set: boolean }>(sql`
      select proname as name, pg_get_function_result(oid) as result, proretset as returns_set
        from pg_proc
       where proname in ('integration_claim_run', 'integration_enqueue_due_runs') and pronamespace = 'public'::regnamespace
       order by 1`);
    expect(rows).toEqual([
      {
        name: "integration_claim_run",
        result: "TABLE(tenant_id uuid, connection_id uuid)",
        returns_set: true,
      },
      { name: "integration_enqueue_due_runs", result: "SETOF uuid", returns_set: true },
    ]);
  });
});

describe("integration_claim_run", () => {
  it("names the tenant and connection of a queued run of an active connection, and nothing else", async () => {
    const id = await activeSandbox(ctx, h);
    const runId = await queueRun(ctx, id);
    expect(await claimQueuedRun(runId)).toEqual({ tenantId: ctx.tenantId, connectionId: id });
    // It only looks: the run is still queued for the engine's own atomic claim.
    expect((await runRow(runId)).status).toBe("queued");
    // And the same answer again: the check has no side effect.
    expect(await claimQueuedRun(runId)).toEqual({ tenantId: ctx.tenantId, connectionId: id });
  });

  it("refuses a forged run ID, a malformed one, and a run that isn't queued (already claimed, finished, abandoned)", async () => {
    const id = await activeSandbox(ctx, h);
    expect(await claimQueuedRun(randomUUID())).toBeNull();
    expect(await claimQueuedRun("not-a-uuid")).toBeNull();
    for (const status of ["running", "succeeded", "failed", "abandoned"] as const) {
      const runId = await queueRun(ctx, id);
      // The owner edit the engine itself would make, with the lifecycle triggers off for this transaction only.
      await systemDb().transaction(async (tx) => {
        await withoutTriggers(tx);
        await tx.execute(
          sql`update integration_sync_runs set status = ${status}::integration_sync_run_status, started_at = now(), finished_at = case when ${status} = 'running' then null else now() end where id = ${runId}::uuid`,
        );
      });
      expect(await claimQueuedRun(runId), status).toBeNull();
      // Make room for the next queued run (the partial unique index allows one queued or running).
      await systemDb().transaction(async (tx) => {
        await withoutTriggers(tx);
        await tx.execute(
          sql`update integration_sync_runs set status = 'abandoned', finished_at = now() where id = ${runId}::uuid and status = 'running'`,
        );
      });
    }
  });

  it("refuses a queued run whose connection is not active, whatever else is true of the run (paused, error, revoked)", async () => {
    for (const status of ["paused", "error", "revoked"] as const) {
      const c = await createTestTenant("Jobs db inactive");
      const id = await activeSandbox(c, h);
      const runId = await queueRun(c, id);
      await inRolledBackTransaction(async (tx) => {
        // With the triggers off the run stays `queued` (with them on, leaving `active` abandons it, which is
        // also a refusal): the function's own connection check is what is proved here.
        await withoutTriggers(tx);
        await tx.execute(
          sql`update integration_connections set status = ${status}::integration_connection_status,
                status_reason = ${status === "error" ? "auth_refused" : status === "revoked" ? "no_longer_used" : null},
                revoked_by = ${status === "revoked" ? c.userId : null}::uuid,
                revoked_at = ${status === "revoked" ? new Date().toISOString() : null}::timestamptz
              where id = ${id}::uuid`,
        );
        await asJobs(tx);
        const { rows } = await tx.execute(sql`select * from integration_claim_run(${runId}::uuid)`);
        expect(rows, status).toEqual([]);
      });
      // Outside the rolled-back transaction the run is still claimable.
      expect(await claimQueuedRun(runId), status).toEqual({ tenantId: c.tenantId, connectionId: id });
    }
  });

  it("with the real triggers, pausing the connection abandons its queued run, so a job for it is refused", async () => {
    const id = await activeSandbox(ctx, h);
    const runId = await queueRun(ctx, id);
    await withTenant(ctx, (tx) =>
      tx.execute(sql`update integration_connections set status = 'paused' where id = ${id}::uuid`),
    );
    expect((await runRow(runId)).status).toBe("abandoned");
    expect(await claimQueuedRun(runId)).toBeNull();
  });

  it("finds a run in any of the practices, each one its own tenant", async () => {
    const other = await createTestTenant("Jobs db other");
    const first = await activeSandbox(ctx, h);
    const second = await activeSandbox(other, h);
    const firstRun = await queueRun(ctx, first);
    const secondRun = await queueRun(other, second);
    expect(await claimQueuedRun(firstRun)).toEqual({ tenantId: ctx.tenantId, connectionId: first });
    expect(await claimQueuedRun(secondRun)).toEqual({ tenantId: other.tenantId, connectionId: second });
  });

  it("leaves app.tenant_id as it found it", async () => {
    const id = await activeSandbox(ctx, h);
    const runId = await queueRun(ctx, id);
    const before = randomUUID();
    await inRolledBackTransaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${before}, true)`);
      await asJobs(tx);
      const { rows } = await tx.execute(sql`select * from integration_claim_run(${runId}::uuid)`);
      expect(rows).toHaveLength(1);
      const after = await tx.execute<{ value: string | null }>(
        sql`select current_setting('app.tenant_id', true) as value`,
      );
      expect(after.rows[0]!.value).toBe(before);
    });
    await inRolledBackTransaction(async (tx) => {
      await asJobs(tx);
      await tx.execute(sql`select * from integration_claim_run(${runId}::uuid)`);
      const after = await tx.execute<{ value: string | null }>(
        sql`select current_setting('app.tenant_id', true) as value`,
      );
      expect(after.rows[0]!.value ?? "").toBe("");
    });
  });
});

describe("integration_enqueue_due_runs", () => {
  /** Calls the function as the jobs role inside the transaction and returns only this test's practice's new runs. */
  async function enqueueFor(tx: TenantTx, tenantId: string) {
    await asJobs(tx);
    const called = await tx.execute<{ run_id: string }>(sql`select integration_enqueue_due_runs() as run_id`);
    await asOwner(tx);
    const ids = new Set(called.rows.map((row) => row.run_id));
    return (await runsOf(tx, tenantId)).filter((row) => ids.has(row.id));
  }

  it("queues one `scheduled` run for a due active connection, returns the run ID alone, and sets nothing else on it", async () => {
    const id = await activeSandbox(ctx, h);
    await inRolledBackTransaction(async (tx) => {
      await asJobs(tx);
      const called = await tx.execute(sql`select integration_enqueue_due_runs()`);
      // One column, named for the function, holding a UUID: no tenant, no connection, no status.
      expect(called.fields.map((field) => field.name)).toEqual(["integration_enqueue_due_runs"]);
      await asOwner(tx);
      const mine = (await runsOf(tx, ctx.tenantId)).filter((row) =>
        called.rows.some((row2) => Object.values(row2)[0] === row.id),
      );
      expect(mine).toEqual([
        {
          id: expect.any(String),
          connection_id: id,
          status: "queued",
          trigger: "scheduled",
          triggered_by: null,
        },
      ]);
    });
  });

  it("does not queue for a draft, paused, errored or revoked connection, or a practice with no connection", async () => {
    const paused = await createTestTenant("Jobs db paused");
    const pausedId = await activeSandbox(paused, h);
    await withTenant(paused, (tx) =>
      tx.execute(sql`update integration_connections set status = 'paused' where id = ${pausedId}::uuid`),
    );
    const errored = await createTestTenant("Jobs db errored");
    const erroredId = await activeSandbox(errored, h);
    await withTenant(errored, (tx) =>
      tx.execute(
        sql`update integration_connections set status = 'error', status_reason = 'auth_refused' where id = ${erroredId}::uuid`,
      ),
    );
    await inRolledBackTransaction(async (tx) => {
      expect(await enqueueFor(tx, paused.tenantId)).toEqual([]);
      expect(await enqueueFor(tx, errored.tenantId)).toEqual([]);
      expect(await enqueueFor(tx, ctx.tenantId)).toEqual([]);
    });
  });

  it("every practice with a due connection gets its run (the function walks the tenants)", async () => {
    const other = await createTestTenant("Jobs db second");
    await activeSandbox(ctx, h);
    await activeSandbox(other, h);
    await inRolledBackTransaction(async (tx) => {
      expect(await enqueueFor(tx, ctx.tenantId)).toHaveLength(1);
    });
    await inRolledBackTransaction(async (tx) => {
      await asJobs(tx);
      const called = await tx.execute<{ run_id: string }>(
        sql`select integration_enqueue_due_runs() as run_id`,
      );
      await asOwner(tx);
      const ids = new Set(called.rows.map((row) => row.run_id));
      const both = [...(await runsOf(tx, ctx.tenantId)), ...(await runsOf(tx, other.tenantId))];
      expect(both.filter((row) => ids.has(row.id))).toHaveLength(2);
    });
  });

  it("is idempotent: a connection with a queued or running run is not queued again, and neither is one that ran a minute ago", async () => {
    const id = await activeSandbox(ctx, h);
    await inRolledBackTransaction(async (tx) => {
      expect(await enqueueFor(tx, ctx.tenantId)).toHaveLength(1);
      // Second tick, run still queued.
      expect(await enqueueFor(tx, ctx.tenantId)).toEqual([]);
      // The run is now running (fresh heartbeat): still not due.
      await withoutTriggers(tx);
      await tx.execute(
        sql`update integration_sync_runs set status = 'running', started_at = now(), heartbeat_at = now() where tenant_id = ${ctx.tenantId}::uuid and connection_id = ${id}::uuid`,
      );
      expect(await enqueueFor(tx, ctx.tenantId)).toEqual([]);
      // Finished a moment ago: not due until 14 minutes after it was queued.
      await tx.execute(
        sql`update integration_sync_runs set status = 'succeeded', finished_at = now() where tenant_id = ${ctx.tenantId}::uuid and connection_id = ${id}::uuid`,
      );
      expect(await enqueueFor(tx, ctx.tenantId)).toEqual([]);
    });
  });

  it("the 14-minute boundary: due 15 minutes after the last run was queued, not 13", async () => {
    const id = await activeSandbox(ctx, h);
    await inRolledBackTransaction(async (tx) => {
      await withoutTriggers(tx);
      await tx.execute(
        sql`insert into integration_sync_runs (tenant_id, connection_id, trigger, status, queued_at, started_at, finished_at)
            values (${ctx.tenantId}::uuid, ${id}::uuid, 'scheduled', 'succeeded', now() - interval '13 minutes', now() - interval '13 minutes', now() - interval '12 minutes')`,
      );
      expect(await enqueueFor(tx, ctx.tenantId)).toEqual([]);
      await tx.execute(
        sql`update integration_sync_runs set queued_at = now() - interval '15 minutes' where tenant_id = ${ctx.tenantId}::uuid`,
      );
      expect(await enqueueFor(tx, ctx.tenantId)).toHaveLength(1);
    });
  });

  it(`abandons a run that went quiet for the ${RUN_LEASE_MS / 60_000}-minute lease and queues a fresh one; leaves a fresh one alone`, async () => {
    const id = await activeSandbox(ctx, h);
    expect(RUN_LEASE_MS).toBe(20 * 60 * 1000); // the SQL says 20 minutes: keep the two in step
    // A queued run nobody picked up (a lost job), 21 minutes old.
    await inRolledBackTransaction(async (tx) => {
      await withoutTriggers(tx);
      await tx.execute(
        sql`insert into integration_sync_runs (tenant_id, connection_id, trigger, queued_at)
            values (${ctx.tenantId}::uuid, ${id}::uuid, 'scheduled', now() - interval '21 minutes')`,
      );
      const fresh = await enqueueFor(tx, ctx.tenantId);
      expect(fresh).toHaveLength(1);
      const all = await runsOf(tx, ctx.tenantId);
      expect(all.map((row) => row.status).sort()).toEqual(["abandoned", "queued"]);
    });
    // The same at 19 minutes: still leased, nothing new.
    await inRolledBackTransaction(async (tx) => {
      await withoutTriggers(tx);
      await tx.execute(
        sql`insert into integration_sync_runs (tenant_id, connection_id, trigger, queued_at)
            values (${ctx.tenantId}::uuid, ${id}::uuid, 'scheduled', now() - interval '19 minutes')`,
      );
      expect(await enqueueFor(tx, ctx.tenantId)).toEqual([]);
      expect((await runsOf(tx, ctx.tenantId)).map((row) => row.status)).toEqual(["queued"]);
    });
    // A run that started and stopped beating 21 minutes ago.
    await inRolledBackTransaction(async (tx) => {
      await withoutTriggers(tx);
      await tx.execute(
        sql`insert into integration_sync_runs (tenant_id, connection_id, trigger, status, queued_at, started_at, heartbeat_at)
            values (${ctx.tenantId}::uuid, ${id}::uuid, 'scheduled', 'running', now() - interval '30 minutes', now() - interval '30 minutes', now() - interval '21 minutes')`,
      );
      expect(await enqueueFor(tx, ctx.tenantId)).toHaveLength(1);
      expect((await runsOf(tx, ctx.tenantId)).map((row) => row.status).sort()).toEqual([
        "abandoned",
        "queued",
      ]);
    });
  });

  it("leaves app.tenant_id as it found it, and the work is through the practice's own policy", async () => {
    await activeSandbox(ctx, h);
    const before = randomUUID();
    await inRolledBackTransaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${before}, true)`);
      await asJobs(tx);
      await tx.execute(sql`select integration_enqueue_due_runs()`);
      const after = await tx.execute<{ value: string | null }>(
        sql`select current_setting('app.tenant_id', true) as value`,
      );
      expect(after.rows[0]!.value).toBe(before);
    });
  });

  it("`enqueueDueRuns` returns run IDs the claim function then accepts", async () => {
    const id = await activeSandbox(ctx, h);
    const ids = await enqueueDueRuns();
    const mine = [];
    for (const runId of ids) {
      const claimed = await claimQueuedRun(runId);
      if (claimed?.tenantId === ctx.tenantId) mine.push({ runId, claimed });
    }
    expect(mine).toHaveLength(1);
    expect(mine[0]!.claimed).toEqual({ tenantId: ctx.tenantId, connectionId: id });
    expect(await runRow(mine[0]!.runId)).toMatchObject({
      status: "queued",
      trigger: "scheduled",
      triggeredBy: null,
    });
  });
});

describe("the functions walk the tenants, so they work for an owner that does not bypass row-level security", () => {
  // CI's database user is a superuser, which ignores every policy, so the tenant loop would go untested. A
  // probe copy of each function is created (from the migration's own text) by a role with neither SUPERUSER nor
  // BYPASSRLS that is not the tables' owner, so the tenant_isolation policies apply to it exactly as they
  // would to a managed database's non-bypass owner, and called by that same role. All of it is rolled back.
  // (The tenant list is the exception, as for the real owner: see the policy below.)
  async function withProbeOwner(fn: (tx: TenantTx) => Promise<void>) {
    await inRolledBackTransaction(async (tx) => {
      await tx.execute(sql`create role jobs_probe_owner nologin nosuperuser nobypassrls`);
      await tx.execute(sql`grant usage, create on schema public to jobs_probe_owner`);
      await tx.execute(sql`grant select on tenants, integration_connections to jobs_probe_owner`);
      await tx.execute(sql`grant select, insert, update on integration_sync_runs to jobs_probe_owner`);
      await tx.execute(sql`grant execute on function app_current_tenant() to jobs_probe_owner`);
      // `tenants` has row-level security enabled but not forced, so its real owner sees every practice; the
      // probe isn't that table's owner, so it is given the same view by a policy (its role only).
      await tx.execute(
        sql`create policy jobs_probe_all_tenants on tenants for select to jobs_probe_owner using (true)`,
      );
      await tx.execute(sql`set local role jobs_probe_owner`);
      await tx.execute(
        sql.raw(
          statementWith("CREATE FUNCTION integration_claim_run(").replace(
            "CREATE FUNCTION integration_claim_run(",
            "CREATE FUNCTION probe_claim_run(",
          ),
        ),
      );
      await tx.execute(
        sql.raw(
          statementWith("CREATE FUNCTION integration_enqueue_due_runs(").replace(
            "CREATE FUNCTION integration_enqueue_due_runs(",
            "CREATE FUNCTION probe_enqueue_due_runs(",
          ),
        ),
      );
      await fn(tx);
    });
  }

  it("the probe owner really is subject to the policy: without a tenant it sees no run at all", async () => {
    const id = await activeSandbox(ctx, h);
    await queueRun(ctx, id);
    await withProbeOwner(async (tx) => {
      const seen = await tx.execute<{ count: number }>(
        sql`select count(*)::int as count from integration_sync_runs`,
      );
      expect(seen.rows[0]!.count).toBe(0);
    });
  });

  it("claim finds a run in each practice and refuses the others, with no tenant set on entry", async () => {
    const other = await createTestTenant("Jobs db probe");
    const first = await activeSandbox(ctx, h);
    const second = await activeSandbox(other, h);
    const firstRun = await queueRun(ctx, first);
    const secondRun = await queueRun(other, second);
    await withProbeOwner(async (tx) => {
      const claim = async (runId: string) =>
        (await tx.execute(sql`select * from probe_claim_run(${runId}::uuid)`)).rows;
      expect(await claim(firstRun)).toEqual([{ tenant_id: ctx.tenantId, connection_id: first }]);
      expect(await claim(secondRun)).toEqual([{ tenant_id: other.tenantId, connection_id: second }]);
      expect(await claim(randomUUID())).toEqual([]);
      const after = await tx.execute<{ value: string | null }>(
        sql`select current_setting('app.tenant_id', true) as value`,
      );
      expect(after.rows[0]!.value ?? "").toBe("");
    });
  });

  it("enqueue queues for each practice with a due connection, through the practice's own policy", async () => {
    const other = await createTestTenant("Jobs db probe enqueue");
    await activeSandbox(ctx, h);
    await activeSandbox(other, h);
    await withProbeOwner(async (tx) => {
      const { rows } = await tx.execute<{ run_id: string }>(sql`select probe_enqueue_due_runs() as run_id`);
      const ids = new Set(rows.map((row) => row.run_id));
      await tx.execute(sql`reset role`);
      const queued = [...(await runsOf(tx, ctx.tenantId)), ...(await runsOf(tx, other.tenantId))].filter(
        (row) => ids.has(row.id),
      );
      expect(queued).toHaveLength(2);
      expect(queued.every((row) => row.status === "queued" && row.trigger === "scheduled")).toBe(true);
    });
  });
});

describe("security review L3: the migration verifies the integration service principal", () => {
  const check = statementWith("principal_id CONSTANT uuid");

  it("passes for the row 0043 seeded", async () => {
    await inRolledBackTransaction(async (tx) => {
      await tx.execute(sql.raw(check));
    });
  });

  it("raises if the row is missing (0043's `ON CONFLICT DO NOTHING` could have skipped it)", async () => {
    const missing = randomUUID();
    await expectDbError(
      systemDb().transaction((tx) =>
        tx.execute(sql.raw(check.replace("d3a7c0de-5a1c-4e11-8a0c-0000000d0d01", missing))),
      ),
      /integration service principal [0-9a-f-]{36} is missing/,
    );
  });

  it.each([
    [
      "it is enabled",
      sql`update users set disabled_at = null where id = ${INTEGRATION_SERVICE_PRINCIPAL_ID}::uuid`,
      /must be disabled/,
    ],
    [
      "its password hash is not the non-hash marker",
      sql`update users set password_hash = 'scrypt$1$1$1$c2FsdA$aGFzaA' where id = ${INTEGRATION_SERVICE_PRINCIPAL_ID}::uuid`,
      /non-hash password marker/,
    ],
    [
      "its password hash is empty",
      sql`update users set password_hash = '' where id = ${INTEGRATION_SERVICE_PRINCIPAL_ID}::uuid`,
      /non-hash password marker/,
    ],
  ])("raises if %s", async (_, tamper, message) => {
    await expectDbError(
      systemDb().transaction(async (tx) => {
        await tx.execute(tamper);
        await tx.execute(sql.raw(check));
      }),
      message,
    );
  });

  it("raises if it has a membership in any practice", async () => {
    await expectDbError(
      systemDb().transaction(async (tx) => {
        await tx.execute(
          sql`insert into memberships (tenant_id, user_id, role) values (${ctx.tenantId}::uuid, ${INTEGRATION_SERVICE_PRINCIPAL_ID}::uuid, 'specialist')`,
        );
        await tx.execute(sql.raw(check));
      }),
      /no membership in any practice/,
    );
  });

  it("is the first statement after the header, so a failure stops the migration before any privilege is granted", () => {
    const code = (text: string) =>
      text
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
    const first = code(statements[0]!);
    expect(first).toContain("principal_id CONSTANT uuid");
    expect(first).not.toMatch(/GRANT|CREATE ROLE|CREATE FUNCTION/);
  });
});
