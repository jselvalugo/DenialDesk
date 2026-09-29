import { sql } from "drizzle-orm";
import { withJobsRole, withTenantAsSystem } from "@/db/tenant";
import { audit } from "@/lib/audit";
import { systemAudit } from "./sync";
import { abandonIfQueued } from "./sync-runs";

// The database side of background jobs (docs/specs/patient-integrations.md "PI2b" Jobs, "PI3"; ADR 0012):
// the two SECURITY DEFINER functions of drizzle/0044 and 0045, called as the `denialdesk_jobs` role. They return
// identifiers only (tenant, connection, run); nothing here reads a practice's data.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ClaimedRun {
  tenantId: string;
  connectionId: string;
}

/**
 * Asks whether `runId` is a `queued` run of an `active` connection and, if so, whose. `null` for
 * everything else: a made-up ID, a run that is running, finished or abandoned (an already-claimed or
 * replayed job), or a run whose connection is paused, in error, or revoked. The caller cannot tell those
 * apart, and neither can an attacker holding a forged `runId`. It changes nothing: the atomic
 * `queued -> running` move is the sync engine's own claim, which refuses a run that is not queued.
 */
export async function claimQueuedRun(runId: string): Promise<ClaimedRun | null> {
  if (!UUID.test(runId)) return null;
  const result = await withJobsRole((tx) =>
    tx.execute<{ tenant_id: string; connection_id: string }>(
      sql`select tenant_id, connection_id from integration_claim_run(${runId}::uuid)`,
    ),
  );
  const row = result.rows[0];
  return row ? { tenantId: row.tenant_id, connectionId: row.connection_id } : null;
}

export interface EnqueuedRun {
  tenantId: string;
  runId: string;
  /** `queued`: a new scheduled run to send a job for. `abandoned`: a run quiet for the 20-minute lease, given up on by the database. */
  outcome: "queued" | "abandoned";
}

/**
 * Queues a `scheduled` run for every due, active connection and returns, for each run it touched, its
 * practice, its ID and what happened (`queued`, or `abandoned` for a run that went quiet for the 20-minute
 * lease): IDs and a word, nothing else, so the caller can audit the abandoned runs and send a job per queued
 * one. `sandboxOnly` limits "due" to the built-in sandbox connections (`SCHEDULED_SANDBOX_ONLY`, until PI4).
 */
export async function enqueueDueRuns(sandboxOnly: boolean): Promise<EnqueuedRun[]> {
  const result = await withJobsRole((tx) =>
    tx.execute<{ tenant_id: string; run_id: string; outcome: string }>(
      sql`select tenant_id, run_id, outcome from integration_enqueue_due_runs(${sandboxOnly}::boolean)`,
    ),
  );
  return result.rows.flatMap((row) =>
    row.outcome === "queued" || row.outcome === "abandoned"
      ? [{ tenantId: row.tenant_id, runId: row.run_id, outcome: row.outcome }]
      : [],
  );
}

/** Why a run was abandoned by the scheduler (the audit event's reason and `reason_code`; a fixed list). */
export type SchedulerAbandonReason = "lease_expired" | "job_not_sent" | "deadline";

async function auditAbandon(
  tenantId: string,
  runId: string,
  reason: SchedulerAbandonReason,
  abandon: boolean,
): Promise<boolean> {
  // The service principal, in the run's own practice, under row-level security: the same context the engine uses.
  return withTenantAsSystem(tenantId, runId, async (tx, ctx) => {
    if (abandon && !(await abandonIfQueued(tx, runId))) return false;
    await audit(
      tx,
      systemAudit(tenantId, "integration.sync_abandoned", ctx.connectionId, reason, {
        run_id: runId,
        reason_code: reason,
        trigger: "scheduled",
      }),
    );
    return true;
  });
}

/** Audits a run the database has already abandoned for going quiet past the lease (`integration.sync_abandoned`, reason `lease_expired`). */
export async function auditLeaseAbandonedRun(tenantId: string, runId: string): Promise<void> {
  await auditAbandon(tenantId, runId, "lease_expired", false);
}

/**
 * Abandons a queued run the scheduler could not (or did not get to) send a job for, and audits it. Returns
 * `false`, writing nothing, if the run is no longer queued (a worker claimed it: the job did arrive, or another
 * tick handled it). Freeing the run means the next tick queues the connection again at once, instead of it
 * waiting out the 20-minute lease.
 */
export async function abandonUnsentRun(
  tenantId: string,
  runId: string,
  reason: "job_not_sent" | "deadline",
): Promise<boolean> {
  return auditAbandon(tenantId, runId, reason, true);
}
