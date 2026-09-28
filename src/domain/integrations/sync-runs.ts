import { desc, eq } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { integrationSyncRuns } from "@/db/schema";

// Sync run history reads (docs/specs/patient-integrations.md "PI1b"/"PI2b"). No writes here yet:
// the sync engine (jobs, sandbox, `withTenantAsSystem`) is PI2b. Counts and codes only, never
// patient data (spec "Sync history").

export type SyncRunRow = typeof integrationSyncRuns.$inferSelect;

/** A connection's sync runs, most recent first. Empty until PI2b's sync engine exists. */
export async function listSyncRuns(tx: TenantTx, connectionId: string): Promise<SyncRunRow[]> {
  return tx
    .select()
    .from(integrationSyncRuns)
    .where(eq(integrationSyncRuns.connectionId, connectionId))
    .orderBy(desc(integrationSyncRuns.queuedAt));
}
