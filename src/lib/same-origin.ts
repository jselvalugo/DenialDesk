/**
 * A state-changing POST route handler (not a Server Action, which the framework already
 * origin-checks) must check its own origin against the request's Host to resist cross-site form
 * submission.
 *
 * `Sec-Fetch-Site` (sent by every modern browser) is checked first, because it survives a
 * situation the plain `Origin` header can't handle here: this app's own CSP sends
 * `Referrer-Policy: no-referrer`, and browsers send a literal `Origin: null` (not an absent
 * header) for a same-origin, full-page form POST when the page's referrer policy is
 * `no-referrer` — a real, legitimate request (e.g. the Insight "Download Excel" button), not a
 * forged one. `new URL("null")` would throw and the old Origin-only check treated that as a
 * mismatch, rejecting every such same-origin download with a 403. `Sec-Fetch-Site` isn't affected
 * by the referrer policy and correctly reports "same-origin" for these requests, so it is checked
 * first and, when present, is authoritative.
 *
 * If the browser sent no `Sec-Fetch-Site` header (very old browsers) and no `Origin` header
 * either, this can't tell either way and lets the request through the session cookie's own
 * SameSite=Lax protection (src/auth/session.ts), which already blocks a cross-site POST from
 * carrying the session cookie in that case.
 */
export function isSameOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "none";

  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
