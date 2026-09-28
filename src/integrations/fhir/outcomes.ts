import { isTransportError, type TransportErrorCode } from "./errors";

/**
 * What "Test connection" tells the administrator (docs/specs/patient-integrations.md PI2a): a short,
 * fixed vocabulary, so the test can't be used as a port-scan or content oracle (threat model D2).
 * `ok` plus the six failures; nothing from the remote server (URL, body, error text) rides along.
 */
export const CONNECTION_OUTCOMES = [
  "ok",
  "unreachable",
  "tls_failed",
  "not_fhir_r4",
  "smart_config_invalid",
  "auth_refused",
  "capability_missing",
] as const;
export type ConnectionOutcome = (typeof CONNECTION_OUTCOMES)[number];
export type FailureOutcome = Exclude<ConnectionOutcome, "ok">;

/** Raised by discovery and the token request; carries only fixed codes, never a message from the remote. */
export class FhirConnectError extends Error {
  constructor(
    readonly outcome: FailureOutcome,
    /** The transport-level code behind an `unreachable`/`tls_failed` outcome, for security events. */
    readonly transportCode?: TransportErrorCode,
    /** Why, when the outcome alone is ambiguous (`scope_insufficient` collapses to `capability_missing`). */
    readonly detail?: "scope_insufficient" | "bad_token_response" | "token_endpoint_changed",
  ) {
    super(outcome);
    this.name = "FhirConnectError";
  }
}

export function isFhirConnectError(error: unknown): error is FhirConnectError {
  return error instanceof FhirConnectError;
}

/**
 * Transport codes the spec says must be emitted as ID-only security events (spec "Callers of the
 * transport"): the destination or its TLS/redirect behavior is what is suspicious, not the request.
 */
export const SECURITY_TRANSPORT_CODES: readonly TransportErrorCode[] = [
  "address_refused",
  "tls_failed",
  "redirect_refused",
];

export function isSecurityTransportCode(code: TransportErrorCode | undefined): boolean {
  return code !== undefined && SECURITY_TRANSPORT_CODES.includes(code);
}

/**
 * Collapses a transport error into an outcome. `fallback` is what an unusable *answer* means for the
 * call at hand (a wrong Content-Type, an oversized body): `not_fhir_r4` for `metadata`,
 * `smart_config_invalid` for `smart-configuration`, `auth_refused` for the token endpoint. A refused
 * address or redirect reads as `unreachable` to the administrator (no oracle) but keeps its code.
 */
export function outcomeForTransportError(error: unknown, fallback: FailureOutcome): FhirConnectError {
  if (!isTransportError(error)) throw error;
  switch (error.code) {
    case "tls_failed":
      return new FhirConnectError("tls_failed", error.code);
    case "content_type_refused":
    case "too_large":
      return new FhirConnectError(fallback, error.code);
    default:
      return new FhirConnectError("unreachable", error.code);
  }
}

/**
 * Non-2xx status handling shared by discovery and the token request. 401/403 mean the server wants
 * credentials this call can't have (`auth_refused`); 408/425/429 and 5xx are the server's trouble
 * (`unreachable`); anything else means the URL isn't the thing we asked for (`invalidOutcome`).
 */
export function outcomeForStatus(status: number, invalidOutcome: FailureOutcome): FhirConnectError {
  if (status === 401 || status === 403) return new FhirConnectError("auth_refused");
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return new FhirConnectError("unreachable");
  }
  return new FhirConnectError(invalidOutcome);
}
