// Which FHIR identifier system may be used as the practice's MRN (docs/specs/patient-integrations.md
// PI1b). A government or payer identifier is never a medical record number: syncing it as the MRN
// would put an SSN, MBI, driver's license, or passport number in the least protected identifier
// column (field-level encryption covers SSN and MBI, R-7.3.3; the MRN is shown and searched).
// ⚠️ VERIFY the list with the edi-x12-specialist / counsel before the first real practice.

export const MAX_IDENTIFIER_SYSTEM_LENGTH = 255;

/** Exact systems refused (compared lowercased, trimmed). */
const REFUSED_SYSTEMS = new Set([
  "http://hl7.org/fhir/sid/us-ssn",
  "urn:oid:2.16.840.1.113883.4.1", // SSN
  "http://hl7.org/fhir/sid/us-mbi",
  "http://hl7.org/fhir/sid/us-medicare",
]);

/** Prefixes refused: state driver's-license OIDs (2.16.840.1.113883.4.3.<state>) and passports. */
const REFUSED_PREFIXES = ["urn:oid:2.16.840.1.113883.4.3.", "http://hl7.org/fhir/sid/passport-"];

export type IdentifierSystemCode = "invalid" | "too_long" | "government_identifier";

export type IdentifierSystemResult = { ok: true; system: string } | { ok: false; code: IdentifierSystemCode };

/** An identifier system is a URI: an http(s) URL or an OID/UUID URN (FHIR `Identifier.system`). */
const SYSTEM_SHAPE = /^(https?:\/\/[^\s]+|urn:oid:[0-2](\.(0|[1-9][0-9]*))+|urn:uuid:[0-9a-f-]{36})$/i;

export function checkMrnIdentifierSystem(raw: string): IdentifierSystemResult {
  const system = raw.trim();
  if (system.length === 0) return { ok: false, code: "invalid" };
  if (system.length > MAX_IDENTIFIER_SYSTEM_LENGTH) return { ok: false, code: "too_long" };
  if (!SYSTEM_SHAPE.test(system)) return { ok: false, code: "invalid" };
  // Compare on a canonical form: lowercase, and https treated like http (the hl7.org sids are
  // published as http:// but are sometimes typed with https://).
  const canonical = system
    .toLowerCase()
    .replace(/^https:\/\//, "http://")
    .replace(/\/+$/, "");
  if (REFUSED_SYSTEMS.has(canonical) || REFUSED_PREFIXES.some((prefix) => canonical.startsWith(prefix))) {
    return { ok: false, code: "government_identifier" };
  }
  return { ok: true, system };
}
