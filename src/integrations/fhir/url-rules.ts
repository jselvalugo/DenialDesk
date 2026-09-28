/**
 * URL rules for an EHR/PM base URL (docs/specs/patient-integrations.md "PI1b"; threat model I8,
 * S4): a first, cheap layer of defense before PI2a's full SSRF address guard exists. Pure and
 * synchronous — no DNS lookups here, only syntax and host-name shape.
 */

/** The one built-in synthetic sandbox endpoint (0039/0040; never a real EHR). */
export const SANDBOX_BASE_URL = "https://sandbox.fhir.denialdesk.invalid/r4";
export const SANDBOX_CLIENT_ID = "sandbox-client";
export const SANDBOX_TOKEN_ENDPOINT = "https://sandbox.fhir.denialdesk.invalid/token";
export const SANDBOX_ISSUER = "sandbox-client";

export type UrlRuleError =
  | "invalid_url"
  | "not_https"
  | "has_userinfo"
  | "has_query"
  | "has_fragment"
  | "ip_literal"
  | "blocked_host"
  | "single_label"
  | "trailing_dot"
  | "port_not_allowed";

export interface ValidatedBaseUrl {
  ok: true;
  /** WHATWG-normalized, no trailing slash, no query/fragment; case of the path preserved. */
  normalized: string;
  /** `normalized`, lower-cased, for the endpoint registry and duplicate-connection comparisons. */
  endpointKey: string;
  host: string;
  port: number;
}

export interface InvalidBaseUrl {
  ok: false;
  error: UrlRuleError;
}

// .home.arpa is covered by the general .arpa suffix below (security review PR #81).
const BLOCKED_SUFFIXES = [".local", ".internal", ".arpa", ".onion", ".test", ".example"];
const SANDBOX_HOST = new URL(SANDBOX_BASE_URL).hostname;
const PORT_DIGITS = /^\d{1,5}$/;

/** Parses `INTEGRATION_ALLOWED_PORTS` defensively; 443 is always included regardless of input. Each
 * entry must be 1–5 plain digits (no sign, decimal point, or exponent) before it's even considered
 * as a number, so a value like "1e2" or "+80" is dropped rather than silently accepted. */
export function parseAllowedPorts(raw: string | undefined): Set<number> {
  const ports = new Set<number>([443]);
  if (!raw) return ports;
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!PORT_DIGITS.test(trimmed)) continue;
    const n = Number(trimmed);
    if (n > 0 && n <= 65535) ports.add(n);
  }
  return ports;
}

function isIpLiteral(host: string): boolean {
  // WHATWG keeps brackets on an IPv6 literal's `hostname` ("[::1]"); a colon otherwise never
  // appears in a valid DNS host, so either form is caught by looking for one.
  if (host.includes(":")) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * https, hostname-only (no IP literal, userinfo, query, or fragment), not localhost (or any
 * `*.localhost`)/.local/.internal/.arpa/.onion/.test/.example, not a single-label name, no
 * trailing dot, and a port of 443 or one from `allowedPortsRaw` (`INTEGRATION_ALLOWED_PORTS`).
 * `.invalid` is refused too, **except** the one pinned sandbox host, and only when the caller
 * passes `allowSandboxHost: true` (security review PR #81) — connections.ts never calls this
 * function for the sandbox path at all (it uses the pinned constants directly), so the exemption
 * defaults to off: a real endpoint can never coincidentally validate as "the sandbox".
 */
export function validateBaseUrl(
  raw: string,
  allowedPortsRaw?: string,
  allowSandboxHost = false,
): ValidatedBaseUrl | InvalidBaseUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (url.protocol !== "https:") return { ok: false, error: "not_https" };
  if (url.username || url.password) return { ok: false, error: "has_userinfo" };
  if (url.search) return { ok: false, error: "has_query" };
  if (url.hash) return { ok: false, error: "has_fragment" };

  const host = url.hostname;
  if (isIpLiteral(host)) return { ok: false, error: "ip_literal" };
  if (host.endsWith(".")) return { ok: false, error: "trailing_dot" };
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    return { ok: false, error: "blocked_host" };
  }
  if (host.endsWith(".invalid") && !(allowSandboxHost && host === SANDBOX_HOST)) {
    return { ok: false, error: "blocked_host" };
  }
  if (!host.includes(".")) return { ok: false, error: "single_label" };

  if (url.port && !PORT_DIGITS.test(url.port)) return { ok: false, error: "port_not_allowed" };
  const port = url.port ? Number(url.port) : 443;
  if (!parseAllowedPorts(allowedPortsRaw).has(port)) return { ok: false, error: "port_not_allowed" };

  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  const portSuffix = port === 443 ? "" : `:${port}`;
  const normalized = `https://${host}${portSuffix}${path}`;
  return { ok: true, normalized, endpointKey: normalized.toLowerCase(), host, port };
}
