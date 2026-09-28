// Validates a caller-supplied "come back here" path (step-up's `returnTo`, and anywhere else a
// redirect target reaches the app from a query string or form field): never an open redirect.
// Security review (PR #81): a backslash, a control character, or a second leading slash can all be
// used by a browser to reach another origin even when the string "looks" like a path.

const ALLOWED_PREFIXES = ["/settings/integrations", "/patients", "/"];

function hasControlOrWhitespace(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    // C0/C1 controls, plus the ASCII whitespace characters (space is caught by /\s/ too, but this
    // also catches tab/newline/CR that a browser would strip or reinterpret while normalizing a URL).
    if (code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f) || /\s/.test(value[i]!)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns `value` as a same-origin, allow-listed `pathname + search`, or `fallback` when it isn't
 * one. Rejects a backslash, control characters, and whitespace outright (a browser can treat any
 * of them as a scheme/host separator); requires a single leading slash (`^/[^/\\]`, so `//host` and
 * `/\host` are refused before they ever reach the URL parser); then resolves against a fixed,
 * unreachable internal origin and requires the parse to land back on that exact origin (catches
 * anything the character checks missed, e.g. a bare `scheme:` prefix); finally requires the
 * resulting path to start with one of the app's own top-level sections.
 */
export function safeInternalPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  if (value.includes("\\") || hasControlOrWhitespace(value)) return fallback;
  if (!/^\/[^/\\]/.test(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, "https://internal.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "https://internal.invalid") return fallback;

  const resolved = `${url.pathname}${url.search}`;
  const allowed = ALLOWED_PREFIXES.some(
    (prefix) => resolved === prefix || (prefix !== "/" && resolved.startsWith(`${prefix}/`)),
  );
  return allowed ? resolved : fallback;
}
