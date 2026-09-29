// SSN- and MBI-shaped MRN values (docs/specs/patient-integrations.md PI2b "Refuse SSN- and MBI-shaped
// MRN values at ingest, whatever the identifier system"; security review M-1; threat model I5). The
// identifier-system deny-list (`identifier-rules.ts`) can't know a vendor's local SSN OID, so the
// *value* is checked too. A government identifier must never become the MRN: the MRN is shown and
// searched, while SSN, MBI and member IDs are field-encrypted (CLAUDE.md non-negotiable 6).
//
// Pure functions of a string. Nothing here logs or returns the value: callers get a code.

export type MrnShapeCode = "mrn_looks_like_ssn" | "mrn_looks_like_mbi";

/** `ddd-dd-dddd` (dashes or spaces), anywhere in the value but not inside a longer digit run. */
const SSN_DASHED = /(?<!\d)\d{3}[- ]\d{2}[- ]\d{4}(?!\d)/;
/** Nine digits and nothing else. Allowed only when the operator recorded "MRNs are 9 digits". */
const SSN_BARE = /^\d{9}$/;

/**
 * CMS Medicare Beneficiary Identifier format (11 characters; position 1 a digit 1-9, 2 a letter,
 * 3 a letter or digit, 4 a digit, 5 a letter, 6 a letter or digit, 7 a digit, 8 and 9 letters, 10 and
 * 11 digits; the letters S, L, O, I, B and Z are never used). ⚠️ VERIFY against the CMS "MBI format"
 * publication (https://www.cms.gov/medicare/new-medicare-card/understanding-the-mbi.pdf) before the
 * first real practice. The display form groups it 4-3-4 with dashes.
 */
const MBI_ALPHA = "AC-HJKMNP-RT-Y";
const MBI = new RegExp(
  `^[1-9][${MBI_ALPHA}][${MBI_ALPHA}0-9][0-9][${MBI_ALPHA}][${MBI_ALPHA}0-9][0-9][${MBI_ALPHA}]{2}[0-9]{2}$`,
);
const MBI_DISPLAY = /^[A-Za-z0-9]{4}-[A-Za-z0-9]{3}-[A-Za-z0-9]{4}$/;

/**
 * The synthetic marker a sandbox MRN carries (`SYN-…`). It is stripped before the shape test, so a
 * sandbox fixture such as `SYN-123-45-6789` is judged by what follows the marker, exactly as the same
 * digits without it would be.
 */
const SYN_PREFIX = /^SYN[-_]?/i;

function candidates(value: string): string[] {
  const trimmed = value.trim();
  const withoutMarker = trimmed.replace(SYN_PREFIX, "");
  return withoutMarker === trimmed ? [trimmed] : [trimmed, withoutMarker];
}

function looksLikeMbi(value: string): boolean {
  const compact = MBI_DISPLAY.test(value) ? value.replaceAll("-", "") : value;
  return MBI.test(compact.toUpperCase());
}

/**
 * The refusal code for an SSN- or MBI-shaped MRN value, or null. Bare nine-digit values are refused
 * unless `nineDigitsVerified` (the operator confirmed at approval that this practice's MRNs really are
 * nine digits, `mrn_nine_digits_verified`); dashed SSN shapes and MBI shapes are refused always.
 */
export function mrnShapeProblem(
  value: string,
  options: { nineDigitsVerified: boolean },
): MrnShapeCode | null {
  for (const candidate of candidates(value)) {
    if (SSN_DASHED.test(candidate)) return "mrn_looks_like_ssn";
    if (SSN_BARE.test(candidate) && !options.nineDigitsVerified) return "mrn_looks_like_ssn";
    if (looksLikeMbi(candidate)) return "mrn_looks_like_mbi";
  }
  return null;
}
