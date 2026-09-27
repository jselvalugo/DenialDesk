import { daysUntil, timelyFilingDeadline, type Deadline } from "@rules/deadlines";
import type { Regime } from "@rules/types";
import type { Tone } from "@/components/ui/Badge";
import type { claimStatusEnum } from "@/db/schema";
import type { MessageKey } from "@/i18n/messages/types";

export type ClaimStatus = (typeof claimStatusEnum.enumValues)[number];

export const CLAIM_STATUSES: Record<ClaimStatus, { labelKey: MessageKey<"common">; tone: Tone }> = {
  draft: { labelKey: "claimStatus.draft", tone: "neutral" },
  submitted: { labelKey: "claimStatus.submitted", tone: "info" },
  acknowledged: { labelKey: "claimStatus.acknowledged", tone: "info" },
  rejected: { labelKey: "claimStatus.rejected", tone: "danger" },
  paid: { labelKey: "claimStatus.paid", tone: "success" },
  partially_paid: { labelKey: "claimStatus.partially_paid", tone: "warning" },
  denied: { labelKey: "claimStatus.denied", tone: "danger" },
  closed: { labelKey: "claimStatus.closed", tone: "neutral" },
};

/** Not yet accepted by the payer: the timely-filing clock still matters, and the claim can be corrected. */
export const UNSUBMITTED_STATUSES: ClaimStatus[] = ["draft", "rejected"];

export function isUnsubmitted(status: ClaimStatus): boolean {
  return UNSUBMITTED_STATUSES.includes(status);
}

/** "Filing window closing" warning: a display setting, not a legal value. */
export const FILING_WARNING_DAYS = 30;

export type FilingState = "open" | "due_soon" | "past_deadline" | "not_configured" | "payer_unverified";

/** Message key (claims namespace) for the filing states shown as a plain label (not paired with a day count). */
export const FILING_STATE_LABEL_KEYS: Record<
  Exclude<FilingState, "open" | "due_soon">,
  MessageKey<"claims">
> = {
  past_deadline: "filing.state.pastDeadline",
  not_configured: "filing.state.notConfigured",
  payer_unverified: "filing.state.payerUnverified",
};

export interface FilingStatus {
  state: FilingState;
  deadline: Deadline | null;
  /** Positive = days remaining, 0 = due today, negative = days past. Null when not configured. */
  daysRemaining: number | null;
}

/**
 * Timely-filing status of an unsubmitted claim (R-3.1.5). The deadline comes from the rules engine
 * by the payer's regime; regimes without a statutory rule (payer contract) are "not configured".
 * A null regime means the payer itself is unverified (spec: payer-catalog P1) — DenialDesk never
 * guesses a deadline for it, so no deadline is computed at all. Filing on the deadline itself is
 * on time.
 */
export function filingStatus(regime: Regime | null, serviceDate: string, today: string): FilingStatus {
  if (regime === null) return { state: "payer_unverified", deadline: null, daysRemaining: null };
  const deadline = timelyFilingDeadline(regime, serviceDate);
  if (!deadline) return { state: "not_configured", deadline: null, daysRemaining: null };
  const daysRemaining = daysUntil(deadline.date, today);
  const state: FilingState =
    daysRemaining < 0 ? "past_deadline" : daysRemaining <= FILING_WARNING_DAYS ? "due_soon" : "open";
  return { state, deadline, daysRemaining };
}
