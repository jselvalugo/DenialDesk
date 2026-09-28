// Why a connection is revoked (docs/specs/patient-integrations.md PI2a; compliance review #6a): a
// fixed vocabulary, so the audit "why" column holds a code and never free text that could carry
// patient information. Pure and free of `@/db/*` imports so the revoke form (a client component)
// can use it. Codes match `integration_connections_status_reason_format` (`^[a-z_]{1,64}$`).

export const REVOKE_REASON_CODES = [
  "no_longer_used",
  "switching_systems",
  "configured_in_error",
  "security_concern",
  "other",
] as const;

export type RevokeReasonCode = (typeof REVOKE_REASON_CODES)[number];

/** Message keys (`integrations` namespace) for each reason's label. */
export const REVOKE_REASON_LABEL_KEYS = {
  no_longer_used: "revoke.reason.no_longer_used",
  switching_systems: "revoke.reason.switching_systems",
  configured_in_error: "revoke.reason.configured_in_error",
  security_concern: "revoke.reason.security_concern",
  other: "revoke.reason.other",
} as const satisfies Record<RevokeReasonCode, `revoke.reason.${RevokeReasonCode}`>;

export function isRevokeReasonCode(value: unknown): value is RevokeReasonCode {
  return typeof value === "string" && (REVOKE_REASON_CODES as readonly string[]).includes(value);
}
