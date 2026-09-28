import { desc, eq } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { integrationSyncRuns } from "@/db/schema";
import { en } from "@/i18n/messages/en";
import type { MessageKey, Messages } from "@/i18n/messages/types";
import { createTranslator, type Translator } from "@/i18n/translate";

// Sync run history reads (docs/specs/patient-integrations.md "PI1b"/"PI2b"). No writes here yet:
// the sync engine (jobs, sandbox, `withTenantAsSystem`) is PI2b. Counts and codes only, never
// patient data (spec "Sync history").

export type SyncRunRow = typeof integrationSyncRuns.$inferSelect;
export type SyncRunStatus = SyncRunRow["status"];

/** A connection's sync runs, most recent first. Empty until PI2b's sync engine exists. */
export async function listSyncRuns(tx: TenantTx, connectionId: string): Promise<SyncRunRow[]> {
  return tx
    .select()
    .from(integrationSyncRuns)
    .where(eq(integrationSyncRuns.connectionId, connectionId))
    .orderBy(desc(integrationSyncRuns.queuedAt));
}

type SettingsKey = MessageKey<"settings">;
type SettingsT = Translator<Messages["settings"]>;
const englishSettingsT: SettingsT = createTranslator(en.settings, "en");

const RUN_STATUS_LABEL_KEYS = {
  queued: "integrations.runs.status.queued",
  running: "integrations.runs.status.running",
  succeeded: "integrations.runs.status.succeeded",
  failed: "integrations.runs.status.failed",
  abandoned: "integrations.runs.status.abandoned",
} as const satisfies Record<SyncRunStatus, SettingsKey>;

export function syncRunStatusLabel(status: SyncRunStatus, t: SettingsT = englishSettingsT): string {
  return t(RUN_STATUS_LABEL_KEYS[status]);
}
