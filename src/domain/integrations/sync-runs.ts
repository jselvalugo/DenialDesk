import { and, eq, inArray, sql } from "drizzle-orm";
import { integrationSyncRuns } from "@/db/schema";
import { isUniqueViolation, type DatabaseError, type TenantTx } from "@/db/tenant";

// Sync-run bookkeeping for a connection (docs/specs/patient-integrations.md PI2b): the lease that
// keeps a dead run from blocking the next one, and queueing a run. The run itself is executed by
// `sync.ts` under `withTenantAsSystem`. `integration_sync_runs` grants INSERT on four columns only
// (drizzle/0039), so the insert is raw SQL naming exactly those, as `insertDraft` does for connections.

/** "No heartbeat for 20 min -> abandoned" (spec PI2b). A product rule, not a legal value. */
export const RUN_LEASE_MS = 20 * 60 * 1000;

/**
 * Abandons this connection's runs that have gone quiet: a `running` run with no heartbeat (or, if it
 * never beat, no start) for 20 minutes, or a `queued` run older than that that nobody picked up. The
 * platform can kill a run mid-page (threat model D4); the pages it committed stay, its watermark was
 * never advanced, and the next run re-fetches. Uses the database clock. Returns how many were abandoned.
 */
export async function abandonStaleRuns(
  tx: TenantTx,
  tenantId: string,
  connectionId: string,
): Promise<number> {
  const lease = sql`make_interval(secs => ${RUN_LEASE_MS / 1000}::float8)`;
  const abandoned = await tx
    .update(integrationSyncRuns)
    .set({ status: "abandoned", finishedAt: sql`now()` })
    .where(
      and(
        eq(integrationSyncRuns.tenantId, tenantId),
        eq(integrationSyncRuns.connectionId, connectionId),
        sql`(
          (${integrationSyncRuns.status} = 'running'
            and coalesce(${integrationSyncRuns.heartbeatAt}, ${integrationSyncRuns.startedAt}) < now() - ${lease})
          or (${integrationSyncRuns.status} = 'queued' and ${integrationSyncRuns.queuedAt} < now() - ${lease})
        )`,
      ),
    )
    .returning({ id: integrationSyncRuns.id });
  return abandoned.length;
}

/** Whether a run of this connection is queued or running right now (one at a time, partial unique index). */
export async function hasActiveRun(tx: TenantTx, tenantId: string, connectionId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: integrationSyncRuns.id })
    .from(integrationSyncRuns)
    .where(
      and(
        eq(integrationSyncRuns.tenantId, tenantId),
        eq(integrationSyncRuns.connectionId, connectionId),
        inArray(integrationSyncRuns.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** True for the unique violation of "one queued/running run per connection" (two Sync nows racing). */
export function isRunAlreadyActive(error: unknown): boolean {
  return (
    isUniqueViolation(error) && (error as DatabaseError).constraint === "integration_sync_runs_one_active"
  );
}

/**
 * Queues a run. `triggeredBy` is the administrator who pressed Sync now (null for a scheduled run,
 * PI3); the trigger `manual`/`scheduled` is a CHECK-constrained column. The row is `queued`; the
 * engine moves it to `running`.
 */
export async function insertQueuedRun(
  tx: TenantTx,
  input: {
    tenantId: string;
    connectionId: string;
    trigger: "manual" | "scheduled";
    triggeredBy: string | null;
  },
): Promise<string> {
  const result = await tx.execute<{ id: string }>(sql`
    insert into integration_sync_runs (tenant_id, connection_id, trigger, triggered_by)
    values (${input.tenantId}::uuid, ${input.connectionId}::uuid, ${input.trigger}, ${input.triggeredBy}::uuid)
    returning id
  `);
  return result.rows[0]!.id;
}
