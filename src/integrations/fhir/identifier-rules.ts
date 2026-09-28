/**
 * MRN identifier-system refusals (docs/specs/patient-integrations.md "PI1b", threat model I5).
 * ⚠️ VERIFY: the exact OID/URI list for driver's-license and passport identifier systems varies by
 * source; the entries below are the ones the spec names.
 */

/** Exact systems refused outright: SSN, MBI, and the generic Medicare identifier. */
const REFUSED_SYSTEMS = new Set<string>([
  "http://hl7.org/fhir/sid/us-ssn",
  "urn:oid:2.16.840.1.113883.4.1", // SSN OID
  "http://hl7.org/fhir/sid/us-mbi",
  "http://hl7.org/fhir/sid/us-medicare",
]);

/** Prefix families refused: state driver's-license OIDs and passport identifier systems. */
const REFUSED_PREFIXES = [
  "urn:oid:2.16.840.1.113883.4.3.", // driver's license (state-specific suffix)
  "http://hl7.org/fhir/sid/passport-",
];

/** True when `system` names an identifier system that must never be used as the MRN identifier. */
export function isRefusedMrnIdentifierSystem(system: string): boolean {
  const value = system.trim();
  if (REFUSED_SYSTEMS.has(value)) return true;
  return REFUSED_PREFIXES.some((prefix) => value.startsWith(prefix));
}
