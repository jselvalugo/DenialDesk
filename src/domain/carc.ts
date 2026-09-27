import type { denialCategoryEnum } from "@/db/schema";
import type { MessageKey } from "@/i18n/messages/types";

export type DenialCategory = (typeof denialCategoryEnum.enumValues)[number];

/**
 * Claim Adjustment Reason Codes used by DenialDesk.
 * Source: X12 CARC list, https://x12.org/codes/claim-adjustment-reason-codes
 * ⚠️ VERIFY: descriptions are summaries; confirm wording against the current X12 release before
 * showing them as official text, and load the full list from X12 with the 835 ingestion feature.
 * `category` is DenialDesk's own work-queue classification (REQUIREMENTS §8.3), not part of X12.
 */
export const CARC: Record<string, { summary: string; category: DenialCategory }> = {
  "4": {
    summary: "Procedure code inconsistent with the modifier, or required modifier missing",
    category: "coding",
  },
  "11": { summary: "Diagnosis inconsistent with the procedure", category: "coding" },
  "16": {
    summary: "Claim lacks information or has submission/billing errors",
    category: "missing_information",
  },
  "18": { summary: "Exact duplicate claim/service", category: "duplicate" },
  "22": {
    summary: "May be covered by another payer per coordination of benefits",
    category: "coordination_of_benefits",
  },
  "26": { summary: "Expenses incurred prior to coverage", category: "eligibility" },
  "27": { summary: "Expenses incurred after coverage terminated", category: "eligibility" },
  "29": { summary: "Time limit for filing has expired", category: "timely_filing" },
  "31": { summary: "Patient cannot be identified as the payer's insured", category: "eligibility" },
  "50": {
    summary: "Non-covered: not deemed a medical necessity by the payer",
    category: "medical_necessity",
  },
  "97": {
    summary: "Benefit included in the payment for another service already adjudicated",
    category: "bundling",
  },
  "109": {
    summary: "Not covered by this payer; send to the correct payer",
    category: "coordination_of_benefits",
  },
  "197": { summary: "Precertification/authorization/notification absent", category: "authorization" },
  "204": { summary: "Service not covered under the patient's current benefit plan", category: "eligibility" },
  "252": { summary: "An attachment or other documentation is required", category: "missing_information" },
};

/** Message key (common namespace) for each category's name; show it with `t(CATEGORY_LABEL_KEYS[c])`. */
export const CATEGORY_LABEL_KEYS: Record<DenialCategory, MessageKey<"common">> = {
  eligibility: "category.eligibility",
  authorization: "category.authorization",
  coding: "category.coding",
  medical_necessity: "category.medical_necessity",
  timely_filing: "category.timely_filing",
  duplicate: "category.duplicate",
  bundling: "category.bundling",
  coordination_of_benefits: "category.coordination_of_benefits",
  missing_information: "category.missing_information",
  credentialing: "category.credentialing",
  other: "category.other",
};

/** Categories in their canonical order (the order of the reference table above). */
export const CATEGORY_ORDER = Object.keys(CATEGORY_LABEL_KEYS) as DenialCategory[];

/** Category for a CARC; unknown codes go to "other" for a human to classify. */
export function categorize(carc: string): DenialCategory {
  return CARC[carc]?.category ?? "other";
}
