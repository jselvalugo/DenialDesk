import type { Tone } from "@/components/ui/Badge";
import type { RemittanceAdjustment, remittanceMethodEnum, remittanceStatusEnum } from "@/db/schema";
import type { ClaimStatus } from "@/domain/claims/status";

export type RemittanceStatus = (typeof remittanceStatusEnum.enumValues)[number];
export type RemittanceMethod = (typeof remittanceMethodEnum.enumValues)[number];

export const REMITTANCE_STATUSES: Record<RemittanceStatus, { label: string; tone: Tone }> = {
  received: { label: "Ready to post", tone: "info" },
  posted: { label: "Posted", tone: "success" },
  void: { label: "Void", tone: "neutral" },
};

export const METHOD_LABELS: Record<RemittanceMethod, string> = {
  check: "Check",
  eft: "EFT",
  non_payment: "No payment",
};

/**
 * CLP02 claim status codes (X12 835 5010, Claim Status Code list). Labels only; posting logic uses
 * "4" (denied) and refuses "22" (reversal) until phase R2.
 */
export const CLP_STATUS_LABELS: Record<string, string> = {
  "1": "Processed as primary",
  "2": "Processed as secondary",
  "3": "Processed as tertiary",
  "4": "Denied",
  "19": "Primary, forwarded",
  "20": "Secondary, forwarded",
  "21": "Tertiary, forwarded",
  "22": "Reversal",
  "23": "Not our claim, forwarded",
  "25": "Predetermination only",
};

/**
 * Adjustments that don't reduce what the practice expected: patient responsibility (group PR) and
 * the contractual fee-schedule reduction (CO-45, "charge exceeds fee schedule/maximum allowable",
 * X12 CARC list). Anything else leaves a claim partially paid.
 */
export function isExpected(adjustment: RemittanceAdjustment): boolean {
  return adjustment.group === "PR" || (adjustment.group === "CO" && adjustment.carc === "45");
}

/** The claim status after posting one claim payment, given the claim's paid total afterward. */
export function postedClaimStatus(input: {
  statusCode: string;
  paidTotalCents: number;
  adjustments: RemittanceAdjustment[];
}): Extract<ClaimStatus, "paid" | "partially_paid" | "denied"> {
  const expected = input.adjustments.every(isExpected);
  if (input.paidTotalCents <= 0) {
    // Processed with nothing paid because it all went to the patient (e.g. deductible) is not a denial.
    return input.statusCode !== "4" && expected && input.adjustments.length > 0 ? "paid" : "denied";
  }
  // Paid earlier and denied now (or reduced): money came in, so not a full denial.
  return input.statusCode !== "4" && expected ? "paid" : "partially_paid";
}

/** Claims paid minus provider-level adjustments must equal the payment (835 balancing). */
export function isBalanced(input: {
  totalPaidCents: number;
  providerAdjustmentCents: number;
  claimsPaidCents: number;
}): boolean {
  return input.claimsPaidCents - input.providerAdjustmentCents === input.totalPaidCents;
}
