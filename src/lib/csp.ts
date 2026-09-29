import { randomBytes } from "node:crypto";

/**
 * The Content-Security-Policy every page gets (SC-B10.1; security review finding 10; OWASP ASVS
 * V14.4), set per request by `src/proxy.ts`. Scripts need the request's nonce ('strict-dynamic'
 * trusts what they load); there is no 'unsafe-eval' in any mode and no 'unsafe-inline' for
 * scripts. Inline style attributes are allowed (used for data-driven widths). `connect-src 'self'`
 * also covers the dev server's same-host hot-reload WebSocket (CSP Level 3).
 */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

/**
 * For responses the proxy does not see (static build assets, `/brand/`, and not-found pages under
 * those paths): nothing may load or run, and nothing may frame them. Set in `next.config.ts`.
 */
export const STATIC_ASSET_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; sandbox";

/** A fresh nonce for every request: 128 bits from the CSPRNG (SC-B7.2), base64-encoded. */
export function newNonce(): string {
  return randomBytes(16).toString("base64");
}
