import { and, eq } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { practiceSettings } from "@/db/schema";

/**
 * A practice-configurable reminder interval, not a legal deadline (spec: appeals.md A1, "Legal
 * rules used"). Never label this a deadline in the UI.
 */
export const DEFAULT_APPEAL_FOLLOW_UP_DAYS = 30;
const FOLLOW_UP_DAYS_KEY = "appeal_follow_up_days";

export async function getAppealFollowUpDays(tx: TenantTx, tenantId: string): Promise<number> {
  const [row] = await tx
    .select({ value: practiceSettings.value })
    .from(practiceSettings)
    .where(and(eq(practiceSettings.tenantId, tenantId), eq(practiceSettings.key, FOLLOW_UP_DAYS_KEY)));
  if (!row) return DEFAULT_APPEAL_FOLLOW_UP_DAYS;
  const parsed = Number.parseInt(row.value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_APPEAL_FOLLOW_UP_DAYS;
}
