/**
 * Claim adjustment group codes on an 835 remittance.
 * Source: X12 835 claim adjustment group codes, https://x12.org/codes/claim-adjustment-group-codes
 * ⚠️ VERIFY: summaries, not the official X12 wording; confirm against the current release before
 * showing them as official text (same caveat as src/domain/carc.ts).
 */
export const GROUP_CODES: Record<string, { name: string; summary: string }> = {
  CO: {
    name: "Contractual obligation",
    summary:
      "The amount is the provider's responsibility under the contract and cannot be billed to the patient.",
  },
  PR: {
    name: "Patient responsibility",
    summary: "The amount may be billed to the patient (deductible, copay, coinsurance).",
  },
  OA: { name: "Other adjustment", summary: "Neither a contractual obligation nor patient responsibility." },
  PI: {
    name: "Payer-initiated reduction",
    summary: "The payer reduced the payment for a reason that is not a contractual obligation.",
  },
};
