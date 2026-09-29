// The fixed vocabularies of operator approval (docs/specs/patient-integrations.md PI1c): how the
// connection was verified with the practice's EHR administrator, who at the practice confirmed it,
// the population the sync is limited to, and why a connection was not approved. Codes, never free
// text, so nothing typed into the console can carry patient information into the audit trail or
// onto a practice's page. Pure and free of `@/db/*` imports so the console's forms (client
// components) can use it. Every code matches `integration_connections_status_reason_format`
// (`^[a-z_]{1,64}$`), since a reject code is stored as the connection's `status_reason`.
//
// ⚠️ The verification-method and contact-role lists are the builder's proposal (the spec says
// "method code" and "the contact's role" without listing them); the owner can change them (OA-066).

export const APPROVAL_METHOD_CODES = [
  "phone_callback",
  "video_call",
  "written_confirmation",
  "vendor_portal",
] as const;
export type ApprovalMethodCode = (typeof APPROVAL_METHOD_CODES)[number];

export const CONTACT_ROLE_CODES = [
  "ehr_administrator",
  "practice_administrator",
  "it_contact",
  "vendor_representative",
  "other",
] as const;
export type ContactRoleCode = (typeof CONTACT_ROLE_CODES)[number];

/** Same values as the `integration_connections_population_scope_valid` CHECK (drizzle/0039). */
export const POPULATION_SCOPES = ["group_export", "verified_filter"] as const;
export type PopulationScope = (typeof POPULATION_SCOPES)[number];

export const REJECT_REASON_CODES = [
  "endpoint_not_verified",
  "client_id_not_verified",
  "contact_not_verified",
  "population_not_scoped",
  "configuration_incorrect",
  "other",
] as const;
export type RejectReasonCode = (typeof REJECT_REASON_CODES)[number];

const isOneOf =
  <T extends string>(codes: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === "string" && (codes as readonly string[]).includes(value);

export const isApprovalMethodCode = isOneOf(APPROVAL_METHOD_CODES);
export const isContactRoleCode = isOneOf(CONTACT_ROLE_CODES);
export const isPopulationScope = isOneOf(POPULATION_SCOPES);
export const isRejectReasonCode = isOneOf(REJECT_REASON_CODES);

/** Message keys (`operator` namespace) for the approval form's option labels. */
export const APPROVAL_METHOD_LABEL_KEYS = {
  phone_callback: "integrations.method.phone_callback",
  video_call: "integrations.method.video_call",
  written_confirmation: "integrations.method.written_confirmation",
  vendor_portal: "integrations.method.vendor_portal",
} as const satisfies Record<ApprovalMethodCode, `integrations.method.${ApprovalMethodCode}`>;

export const CONTACT_ROLE_LABEL_KEYS = {
  ehr_administrator: "integrations.role.ehr_administrator",
  practice_administrator: "integrations.role.practice_administrator",
  it_contact: "integrations.role.it_contact",
  vendor_representative: "integrations.role.vendor_representative",
  other: "integrations.role.other",
} as const satisfies Record<ContactRoleCode, `integrations.role.${ContactRoleCode}`>;

export const POPULATION_SCOPE_LABEL_KEYS = {
  group_export: "integrations.scope.group_export",
  verified_filter: "integrations.scope.verified_filter",
} as const satisfies Record<PopulationScope, `integrations.scope.${PopulationScope}`>;

/** Message keys (`operator` namespace) for the reject form's option labels: short, for the operator. */
export const REJECT_REASON_LABEL_KEYS = {
  endpoint_not_verified: "integrations.rejectReason.endpoint_not_verified",
  client_id_not_verified: "integrations.rejectReason.client_id_not_verified",
  contact_not_verified: "integrations.rejectReason.contact_not_verified",
  population_not_scoped: "integrations.rejectReason.population_not_scoped",
  configuration_incorrect: "integrations.rejectReason.configuration_incorrect",
  other: "integrations.rejectReason.other",
} as const satisfies Record<RejectReasonCode, `integrations.rejectReason.${RejectReasonCode}`>;

/**
 * Message keys (`integrations` namespace) for the notice a practice's administrators read on the
 * connection page after a reject: one whole sentence per reason code (not a fragment spliced into
 * another sentence, which would not translate), written for them, naming no other practice.
 */
export const REJECT_NOTICE_KEYS = {
  endpoint_not_verified: "rejected.notice.endpoint_not_verified",
  client_id_not_verified: "rejected.notice.client_id_not_verified",
  contact_not_verified: "rejected.notice.contact_not_verified",
  population_not_scoped: "rejected.notice.population_not_scoped",
  configuration_incorrect: "rejected.notice.configuration_incorrect",
  other: "rejected.notice.other",
} as const satisfies Record<RejectReasonCode, `rejected.notice.${RejectReasonCode}`>;
