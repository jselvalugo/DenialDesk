/**
 * A state-changing POST route handler (not a Server Action, which the framework already
 * origin-checks) must check its own Origin against the request's Host to resist cross-site form
 * submission. If the browser sent no `Origin` header at all (some same-origin requests omit it),
 * this can't tell either way and lets the request through the session cookie's own protections.
 */
export function isSameOrigin(request: Request): boolean {
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
