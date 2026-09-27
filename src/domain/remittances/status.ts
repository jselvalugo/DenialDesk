import type { Tone } from "@/components/ui/Badge";
import type { RemittanceAdjustment, remittanceMethodEnum, remittanceStatusEnum } from "@/db/schema";
import type { ClaimStatus } from "@/domain/claims/status";
import type { MessageKey } from "@/i18n/messages/types";

export type RemittanceStatus = (typeof remittanceStatusEnum.enumValues)[number];
export type RemittanceMethod = (typeof remittanceMethodEnum.enumValues)[number];

export const REMITTANCE_STATUSES: Record<
  RemittanceStatus,
  { labelKey: MessageKey<"remittances">; tone: Tone }
> = {
  received: { labelKey: "status.received", tone: "info" },
  posted: { labelKey: "status.posted", tone: "success" },
  void: { labelKey: "status.void", tone: "neutral" },
};

export const METHOD_LABEL_KEYS: Record<RemittanceMethod, MessageKey<"remittances">> = {
  check: "method.check",
  eft: "method.eft",
  non_payment: "method.non_payment",
};

/**
 * CLP02 claim status codes (X12 835 5010, Claim Status Code list). Labels only; posting logic uses
 * "4" (denied) and refuses "22" (reversal) until phase R2. Message key (remittances namespace) for
 * each code; an unlisted code shows `clpStatus.other`.
 */
export const CLP_STATUS_LABEL_KEYS: Record<string, MessageKey<"remittances">> = {
  "1": "clpStatus.1",
  "2": "clpStatus.2",
  "3": "clpStatus.3",
  "4": "clpStatus.4",
  "19": "clpStatus.19",
  "20": "clpStatus.20",
  "21": "clpStatus.21",
  "22": "clpStatus.22",
  "23": "clpStatus.23",
  "25": "clpStatus.25",
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
