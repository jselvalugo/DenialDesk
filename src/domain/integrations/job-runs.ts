import { sql } from "drizzle-orm";
import { withJobsRole } from "@/db/tenant";

// The database side of background jobs (docs/specs/patient-integrations.md "PI2b" Jobs, "PI3"; ADR 0012):
// the two SECURITY DEFINER functions of drizzle/0044, called as the `denialdesk_jobs` role. They return
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

/**
 * Queues a `scheduled` run for every due, active connection and returns the new run IDs (nothing
 * else). The function also abandons runs that went quiet for the 20-minute lease, so a lost job is
 * retried on the next tick.
 */
export async function enqueueDueRuns(): Promise<string[]> {
  const result = await withJobsRole((tx) =>
    tx.execute<{ run_id: string }>(sql`select integration_enqueue_due_runs() as run_id`),
  );
  return result.rows.map((row) => row.run_id);
}
