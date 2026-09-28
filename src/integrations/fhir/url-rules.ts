import { isIP } from "node:net";

// Save-time rules for an EHR/PM FHIR base URL (docs/specs/patient-integrations.md PI1b) and the
// normalized endpoint key the cross-practice registry compares (PI1a, M-b). No network access
// here: whether the host *resolves* to a public address is the transport's address guard (PI2a).

/** The built-in synthetic sandbox (in-process, PI2b); pinned by the database CHECK in drizzle/0040. */
export const SANDBOX_BASE_URL = "https://sandbox.fhir.denialdesk.invalid/r4";
export const SANDBOX_CLIENT_ID = "sandbox-client";
/** The sandbox's own MRN identifier system (its `SYN-` MRNs, PI2b); under the sandbox host, not a real OID. */
export const SANDBOX_MRN_SYSTEM = "https://sandbox.fhir.denialdesk.invalid/mrn";
export const SANDBOX_HOST = new URL(SANDBOX_BASE_URL).hostname;

export const MAX_BASE_URL_LENGTH = 2048;

export type UrlRuleCode =
  | "invalid"
  | "too_long"
  | "not_https"
  | "credentials"
  | "query_or_fragment"
  | "ip_literal"
  | "reserved_host"
  | "single_label"
  | "trailing_dot"
  | "port_not_allowed"
  | "path_characters";

export type UrlRuleResult =
  { ok: true; baseUrl: string; endpointKey: string; host: string } | { ok: false; code: UrlRuleCode };

/** Names that only ever reach the local machine or a private network, or are reserved as never
 * resolvable (RFC 6761, RFC 8375, RFC 6762). `.invalid` is refused too, except the sandbox. */
const RESERVED_SUFFIXES = [
  ".localhost",
  ".local",
  ".localdomain",
  ".internal",
  ".arpa", // home.arpa, in-addr.arpa, ip6.arpa
  ".onion",
  ".invalid",
];

/** Path characters a FHIR base URL may use: unreserved plus "/". No percent-escapes, `;` parameters,
 * or anything else, so one endpoint has one spelling (security review L-2) and free text can't ride
 * into the stored URL and its audit metadata (compliance review #8). */
const BASE_PATH = /^[A-Za-z0-9\-._~/]*$/;

/** Ports allowed besides the default: `INTEGRATION_ALLOWED_PORTS` (comma-separated), default `443`. */
export function allowedPorts(raw = process.env.INTEGRATION_ALLOWED_PORTS): Set<number> {
  const ports = (raw ?? "443")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((port) => Number.isInteger(port) && port > 0 && port < 65536);
  return new Set(ports.length > 0 ? ports : [443]);
}

/** An IPv4 address in any form a URL parser or resolver accepts (after WHATWG parsing, dotted quad). */
function isIpLiteral(hostname: string): boolean {
  if (hostname.startsWith("[")) return true;
  return isIP(hostname) !== 0 || /^[0-9.]+$/.test(hostname);
}

/**
 * Checks a FHIR base URL an administrator typed, and returns the value to store plus its endpoint
 * key: WHATWG-normalized scheme + host (+ port when not 443) + path, no trailing slash, path
 * lowercased so two spellings of one endpoint can't both register. The stored `baseUrl` keeps the
 * path's case (FHIR servers may be case-sensitive) and drops a trailing slash.
 */
export function checkBaseUrl(raw: string, ports: Set<number> = allowedPorts()): UrlRuleResult {
  const text = raw.trim();
  if (text.length === 0) return { ok: false, code: "invalid" };
  if (text.length > MAX_BASE_URL_LENGTH) return { ok: false, code: "too_long" };
  // Checked on the raw text too: the parser drops an empty "?" or "#", which should still refuse.
  if (/[?#]/.test(text)) return { ok: false, code: "query_or_fragment" };
  // A backslash is read as "/" by the WHATWG parser, so "host\..\x" would be silently rewritten.
  if (text.includes("\\")) return { ok: false, code: "path_characters" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, code: "invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, code: "not_https" };
  // The raw authority too: "https://@host" parses with an empty username but still carried userinfo.
  const authority = text.replace(/^https:\/\//i, "").split("/")[0] ?? "";
  if (url.username !== "" || url.password !== "" || authority.includes("@")) {
    return { ok: false, code: "credentials" };
  }
  const hostname = url.hostname;
  if (isIpLiteral(hostname)) return { ok: false, code: "ip_literal" };
  if (hostname.endsWith(".")) return { ok: false, code: "trailing_dot" };
  if (!hostname.includes(".")) {
    return { ok: false, code: hostname === "localhost" ? "reserved_host" : "single_label" };
  }
  if (hostname !== SANDBOX_HOST && RESERVED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { ok: false, code: "reserved_host" };
  }
  if (url.port !== "" && !ports.has(Number(url.port))) return { ok: false, code: "port_not_allowed" };

  // The raw path must be what the parser kept: no dot segments or escapes it silently rewrote.
  const rawPath = text.replace(/^https:\/\/[^/]*/i, "");
  if (!BASE_PATH.test(rawPath) || !BASE_PATH.test(url.pathname) || /(^|\/)\.\.?(\/|$)/.test(rawPath)) {
    return { ok: false, code: "path_characters" };
  }
  // Repeated slashes collapse (`/api//r4` and `/api/r4` are one endpoint); a trailing one drops.
  const path = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  const baseUrl = `${url.protocol}//${url.host}${path}`;
  // Again after normalization: punycode can make the stored value longer than what was typed.
  if (baseUrl.length > MAX_BASE_URL_LENGTH) return { ok: false, code: "too_long" };
  return {
    ok: true,
    baseUrl,
    endpointKey: `${url.protocol}//${url.host}${path.toLowerCase()}`,
    host: hostname,
  };
}
