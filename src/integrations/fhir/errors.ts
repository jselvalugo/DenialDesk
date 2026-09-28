/**
 * Outcome codes shared by the FHIR transport, address guard, and run-limit helpers (PI2a part 1,
 * docs/specs/patient-integrations.md). These are the *collapsed* codes the spec lists for the
 * "Test connection" outcome and sync-run issue codes: `unreachable`, `tls_failed`, `too_large`,
 * `timeout`, `redirect_refused`, `paging_loop`, `address_refused`, plus `content_type_refused`
 * (folded into `unreachable` by callers that don't need the finer distinction). Discovery- and
 * auth-specific codes (`not_fhir_r4`, `smart_config_invalid`, `auth_refused`, `capability_missing`,
 * `scope_insufficient`, `issuer_mismatch`, ...) belong to PI2a part 2 / PI2b, not this layer.
 */
export type TransportErrorCode =
  | "unreachable"
  | "tls_failed"
  | "address_refused"
  | "redirect_refused"
  | "content_type_refused"
  | "too_large"
  | "timeout"
  | "paging_loop";

/**
 * Thrown by the transport and run-limit helpers. Carries only the collapsed code and a fixed,
 * code-derived message — never a URL, query string, header, or response body (threat model I1:
 * "PHI, tokens, URLs in logs, errors, audit, run rows"; PI2a spec: "Never include URLs with query
 * strings, bodies or tokens in errors or logs; the URL path is redacted too").
 */
export class TransportError extends Error {
  readonly code: TransportErrorCode;

  constructor(code: TransportErrorCode, message?: string) {
    super(message ?? code);
    this.name = "TransportError";
    this.code = code;
  }
}

export function isTransportError(error: unknown): error is TransportError {
  return error instanceof TransportError;
}
