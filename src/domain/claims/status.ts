import { todayIn } from "@rules/calendar";
import { daysUntil, timelyFilingDeadline, type Deadline } from "@rules/deadlines";
import type { Regime } from "@rules/types";
import type { Tone } from "@/components/ui/Badge";
import type { claimStatusEnum } from "@/db/schema";

export type ClaimStatus = (typeof claimStatusEnum.enumValues)[number];

export const CLAIM_STATUSES: Record<ClaimStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Submitted", tone: "info" },
  acknowledged: { label: "Accepted by payer", tone: "info" },
  rejected: { label: "Rejected", tone: "danger" },
  paid: { label: "Paid", tone: "success" },
  partially_paid: { label: "Partially paid", tone: "warning" },
  denied: { label: "Denied", tone: "danger" },
  closed: { label: "Closed", tone: "neutral" },
};

/** Not yet accepted by the payer: the timely-filing clock still matters, and the claim can be corrected. */
export const UNSUBMITTED_STATUSES: ClaimStatus[] = ["draft", "rejected"];

export function isUnsubmitted(status: ClaimStatus): boolean {
  return UNSUBMITTED_STATUSES.includes(status);
}

/** "Filing window closing" warning: a display setting, not a legal value. */
export const FILING_WARNING_DAYS = 30;

export type FilingState = "open" | "due_soon" | "past_deadline" | "not_configured" | "payer_unverified";

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

export interface SubmittedFilingStatus {
  deadline: Deadline;
  /** The Eastern calendar date the claim was submitted. */
  submittedOn: string;
  /** Submitted on or before the governing (unrolled) deadline; the deadline day itself counts. */
  onTime: boolean;
  /** Late by the governing date but on or before the rolled date that is pending counsel (OA-034). */
  withinPendingExtension: boolean;
}

/**
 * Timely filing of a claim already sent but not yet confirmed received (review D2, R-3.1.5).
 * Measured by the submission date, never today: a claim sent on time must not turn "past deadline"
 * while it waits for the payer's acknowledgement. The owner's answer (2026-09-26, pending counsel)
 * is that a claim is timely when submitted by the deadline, evidenced by the clearinghouse
 * acknowledgement. The submission instant is read as an Eastern calendar date, like `todayIn()`
 * (per-location time zones are an open item in specs/rules-engine-skeleton.md).
 * Null when no deadline is computed (unverified payer or no filing rule for the regime).
 */
export function submittedFilingStatus(
  regime: Regime | null,
  serviceDate: string,
  submittedAt: Date,
): SubmittedFilingStatus | null {
  if (regime === null) return null;
  const deadline = timelyFilingDeadline(regime, serviceDate);
  if (!deadline) return null;
  const submittedOn = todayIn("America/New_York", submittedAt);
  const onTime = daysUntil(deadline.date, submittedOn) >= 0;
  const withinPendingExtension =
    !onTime && deadline.rolledDate !== null && daysUntil(deadline.rolledDate, submittedOn) >= 0;
  return { deadline, submittedOn, onTime, withinPendingExtension };
}
