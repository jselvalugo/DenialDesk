import { MAX_SERVICE_LINES, type Issue837, type Issue837Code } from "@/edi/x12/837p";
import type { MessageKey, Messages } from "@/i18n/messages/types";
import type { Translator } from "@/i18n/translate";

type ClaimsT = Translator<Messages["claims"]>;
type ClaimsKey = MessageKey<"claims">;

/** The sentence for each refusal code (claims namespace). Sentences hold no name, ID, code, date, or amount. */
export const ISSUE_KEYS: Record<Issue837Code, ClaimsKey> = {
  status_not_generatable: "edi.issue.status_not_generatable",
  not_synthetic_environment: "edi.issue.not_synthetic_environment",
  no_member_id: "edi.issue.no_member_id",
  coverage_payer_mismatch: "edi.issue.coverage_payer_mismatch",
  payer_not_verified: "edi.issue.payer_not_verified",
  claim_filing_indicator_unmapped: "edi.issue.claim_filing_indicator_unmapped",
  billing_npi: "edi.issue.billing_npi",
  billing_name: "edi.issue.billing_name",
  billing_taxonomy: "edi.issue.billing_taxonomy",
  billing_tin: "edi.issue.billing_tin",
  billing_address: "edi.issue.billing_address",
  billing_address_po_box: "edi.issue.billing_address_po_box",
  subscriber_name: "edi.issue.subscriber_name",
  subscriber_birth_date: "edi.issue.subscriber_birth_date",
  subscriber_address: "edi.issue.subscriber_address",
  missing_place_of_service: "edi.issue.missing_place_of_service",
  diagnosis_invalid: "edi.issue.diagnosis_invalid",
  diagnosis_pointers_required: "edi.issue.diagnosis_pointers_required",
  diagnosis_pointer_invalid: "edi.issue.diagnosis_pointer_invalid",
  lines_missing: "edi.issue.lines_missing",
  lines_too_many: "edi.issue.lines_too_many",
  line_invalid: "edi.issue.line_invalid",
  billed_mismatch: "edi.issue.billed_mismatch",
  claim_number_invalid: "edi.issue.claim_number_invalid",
  service_date_invalid: "edi.issue.service_date_invalid",
  invalid_character: "edi.issue.invalid_character",
  control_number_exhausted: "edi.issue.control_number_exhausted",
};

/** The name of the field an `invalid_character` refusal points at (never its value). */
export const FIELD_KEYS: Record<string, ClaimsKey> = {
  billing_last_name: "edi.field.billing_last_name",
  billing_first_name: "edi.field.billing_first_name",
  billing_address: "edi.field.billing_address",
  billing_city: "edi.field.billing_city",
  subscriber_last_name: "edi.field.subscriber_last_name",
  subscriber_first_name: "edi.field.subscriber_first_name",
  subscriber_address: "edi.field.subscriber_address",
  subscriber_city: "edi.field.subscriber_city",
  subscriber_member_id: "edi.field.subscriber_member_id",
  payer_name: "edi.field.payer_name",
  envelope_id: "edi.field.envelope_id",
};

export function issueMessage(issue: Issue837, t: ClaimsT): string {
  if (issue.code === "line_invalid" && issue.line === undefined) return t("edi.issue.line_invalid_general");
  const fieldKey = issue.field ? FIELD_KEYS[issue.field] : undefined;
  return t(ISSUE_KEYS[issue.code], {
    line: issue.line ?? 0,
    max: MAX_SERVICE_LINES,
    field: fieldKey ? t(fieldKey) : "",
  });
}
