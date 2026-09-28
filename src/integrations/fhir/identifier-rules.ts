/**
 * MRN identifier-system refusals (docs/specs/patient-integrations.md "PI1b", threat model I5).
 * ⚠️ VERIFY: the exact OID/URI list for MBI, HICN, driver's-license, and passport identifier
 * systems varies by source; the entries below are the ones the spec names plus the security
 * review's additions (PR #81), pending confirmation against an authoritative HL7/CMS registry.
 */

/** Strips a trailing slash and lower-cases (scheme/host are case-insensitive; these known systems
 * carry no meaningfully-cased path segment, so lower-casing the whole value is safe). */
function normalize(system: string): string {
  const trimmed = system.trim().toLowerCase();
  return trimmed.length > 1 && trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

/** An OID given as `urn:oid:2.16...` and one given bare (`2.16...`) name the same system. */
function bareOid(value: string): string {
  return value.startsWith("urn:oid:") ? value.slice("urn:oid:".length) : value;
}

/** Exact systems refused outright: SSN and the generic/URI-form Medicare identifiers. */
const REFUSED_EXACT = new Set<string>(
  [
    "http://hl7.org/fhir/sid/us-ssn",
    "http://hl7.org/fhir/sid/us-mbi",
    "http://hl7.org/fhir/sid/us-medicare",
  ].map((s) => s.toLowerCase()),
);

/** OIDs refused outright (bare form, "urn:oid:" stripped before comparing). */
const REFUSED_OIDS = new Set<string>([
  "2.16.840.1.113883.4.1", // SSN
  "2.16.840.1.113883.4.927", // Medicare Beneficiary Identifier (MBI) — ⚠️ VERIFY
  "2.16.840.1.113883.4.572", // Health Insurance Claim Number (HICN) — ⚠️ VERIFY
]);

/** OID prefix families refused (bare form): state driver's-license OIDs. */
const REFUSED_OID_PREFIXES = ["2.16.840.1.113883.4.3."];

/** URI-form prefix families refused: passport identifier systems. */
const REFUSED_URI_PREFIXES = ["http://hl7.org/fhir/sid/passport-".toLowerCase()];

/** True when `system` names an identifier system that must never be used as the MRN identifier. */
export function isRefusedMrnIdentifierSystem(system: string): boolean {
  const value = normalize(system);
  if (REFUSED_EXACT.has(value)) return true;
  if (REFUSED_URI_PREFIXES.some((prefix) => value.startsWith(prefix))) return true;
  const bare = bareOid(value);
  if (REFUSED_OIDS.has(bare)) return true;
  return REFUSED_OID_PREFIXES.some((prefix) => bare.startsWith(prefix));
}
