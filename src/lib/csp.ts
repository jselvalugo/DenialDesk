/**
 * The Content-Security-Policy every page gets (SC-B10.1; security review finding 10; OWASP ASVS
 * V14.4), set per request by `src/proxy.ts`. Scripts need the request's nonce ('strict-dynamic'
 * trusts what they load); there is no 'unsafe-eval' in any mode and no 'unsafe-inline' for
 * scripts. Inline style attributes are allowed (used for data-driven widths).
 */
export function contentSecurityPolicy(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // The dev server's hot reload uses a WebSocket to the same host.
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** A fresh nonce for every request: 128 bits from the CSPRNG, base64-encoded. */
export function newNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
}
