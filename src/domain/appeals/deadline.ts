import { appealDeadline, type Deadline } from "@rules/deadlines";
import type { Regime } from "@rules/types";

/**
 * The appeal deadline a new first-level appeal should carry, computed fresh from the rules engine
 * (never copied from a possibly-stale denial row). Null ("not configured") when the payer's regime
 * isn't verified or no appeal window is on file for it (spec: appeals.md A1).
 */
export function firstLevelDeadline(input: {
  regime: Regime | null;
  noticeDate: string;
  payerAppealWindowDays: number | null;
}): Deadline | null {
  if (input.regime === null) return null;
  return appealDeadline({
    regime: input.regime,
    noticeDate: input.noticeDate,
    payerAppealWindowDays: input.payerAppealWindowDays,
  });
}
