// Which FHIR identifier system may be used as the practice's MRN (docs/specs/patient-integrations.md
// PI1b). A government or payer identifier is never a medical record number: syncing it as the MRN
// would put an SSN, MBI, driver's license, passport, or member number in the least protected
// identifier column (field-level encryption covers SSN, MBI, and member IDs, R-7.3.3; the MRN is
// shown and searched). A deny-list can't know a vendor's local OID for SSN, so PI2b also refuses
// SSN- and MBI-shaped MRN *values* at ingest (spec "Synthetic sandbox": SSN-shaped MRN fixture).
// ⚠️ VERIFY the list with the edi-x12-specialist / counsel before the first real practice.

export const MAX_IDENTIFIER_SYSTEM_LENGTH = 255;

/** Exact systems refused, in canonical form (see `canonicalSystem`). */
const REFUSED_SYSTEMS = new Set([
  "http://hl7.org/fhir/sid/us-ssn",
  "urn:oid:2.16.840.1.113883.4.1", // SSN
  "http://hl7.org/fhir/sid/us-mbi",
  "urn:oid:2.16.840.1.113883.4.927", // MBI (security review M-1; ⚠️ VERIFY)
  "http://hl7.org/fhir/sid/us-medicare",
  "urn:oid:2.16.840.1.113883.4.572", // Medicare HICN (security review M-1; ⚠️ VERIFY)
  "http://hl7.org/fhir/sid/us-medicaid", // a member ID (non-negotiable 6)
  "urn:oid:2.16.840.1.113883.4.3", // driver's license root (the per-state OIDs are its children)
]);

/** Prefixes refused: state driver's-license OIDs (2.16.840.1.113883.4.3.<state>) and passports. */
const REFUSED_PREFIXES = [
  "urn:oid:2.16.840.1.113883.4.3.",
  "urn:oid:2.16.840.1.113883.4.330.", // passport by country (security review M-1; ⚠️ VERIFY)
  "http://hl7.org/fhir/sid/passport-",
];

export type IdentifierSystemCode = "invalid" | "too_long" | "government_identifier";

export type IdentifierSystemResult = { ok: true; system: string } | { ok: false; code: IdentifierSystemCode };

/** An OID or UUID URN (FHIR `Identifier.system`); http(s) systems are checked with the URL parser. */
const URN_SHAPE = /^(urn:oid:[0-2](\.(0|[1-9][0-9]*))+|urn:uuid:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
/** Path characters an identifier-system URL may use: unreserved plus "/" (no escapes, no ";"). */
const SYSTEM_PATH = /^[A-Za-z0-9\-._~/]*$/;
/** Control, soft-hyphen, zero-width, line/paragraph-separator, and bidi characters (security review
 * L-4). Written as escapes, never raw, so a reviewer can see them (Trojan Source). */
export const INVISIBLE_CHARS =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/;

/**
 * Canonical form for comparison, or null when the system isn't a plain URI. An http(s) system must
 * be a bare `host/path` URL (no userinfo, port, query, fragment, percent-escapes, `;`, or empty path
 * segment), so spellings like `…/us-ssn?`, `…/us-ss%6E`, `hl7.org:80`, or `//us-ssn` can't slip past
 * the list; https is treated as http and a leading `www.` is dropped (the hl7.org sids are
 * published as http://hl7.org/… but are typed in every variant).
 */
function canonicalSystem(system: string): string | null {
  if (/^urn:/i.test(system)) return URN_SHAPE.test(system) ? system.toLowerCase() : null;
  if (!/^https?:\/\//i.test(system) || /[?#@\\]/.test(system)) return null;
  let url: URL;
  try {
    url = new URL(system);
  } catch {
    return null;
  }
  if (
    url.port !== "" ||
    url.hostname.endsWith(".") ||
    !SYSTEM_PATH.test(url.pathname) ||
    /\/\/./.test(url.pathname)
  ) {
    return null;
  }
  // The raw path must be what the parser kept: no escapes or dot segments it silently rewrote.
  const rawPath = system.replace(/^https?:\/\/[^/]*/i, "") || "/";
  if (rawPath !== url.pathname && `${rawPath}/` !== url.pathname) return null;
  const host = url.hostname.replace(/^www\./, "");
  return `http://${host}${url.pathname.replace(/\/+$/, "")}`.toLowerCase();
}

/** The host of an http(s) identifier system (lowercased), or null for a URN or unparsable value. */
export function identifierSystemHost(system: string): string | null {
  if (!/^https?:\/\//i.test(system)) return null;
  try {
    return new URL(system).hostname.replace(/\.$/, "");
  } catch {
    return null;
  }
}

export function checkMrnIdentifierSystem(raw: string): IdentifierSystemResult {
  const system = raw.trim();
  if (system.length === 0) return { ok: false, code: "invalid" };
  if (system.length > MAX_IDENTIFIER_SYSTEM_LENGTH) return { ok: false, code: "too_long" };
  if (INVISIBLE_CHARS.test(system) || /\s/.test(system)) return { ok: false, code: "invalid" };
  const canonical = canonicalSystem(system);
  if (canonical === null) return { ok: false, code: "invalid" };
  if (REFUSED_SYSTEMS.has(canonical) || REFUSED_PREFIXES.some((prefix) => canonical.startsWith(prefix))) {
    return { ok: false, code: "government_identifier" };
  }
  return { ok: true, system };
}
