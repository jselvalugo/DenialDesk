// SSN- and MBI-shaped MRN values (docs/specs/patient-integrations.md PI2b "Refuse SSN- and MBI-shaped
// MRN values at ingest, whatever the identifier system"; security review M-1; threat model I5). The
// identifier-system deny-list (`identifier-rules.ts`) can't know a vendor's local SSN OID, so the
// *value* is checked too. A government identifier must never become the MRN: the MRN is shown and
// searched, while SSN, MBI and member IDs are field-encrypted (CLAUDE.md non-negotiable 6).
//
// Pure functions of a string. Nothing here logs or returns the value: callers get a code.

export type MrnShapeCode = "mrn_looks_like_ssn" | "mrn_looks_like_mbi";

/** Separators a vendor may put between the groups of an SSN or an MBI: dash, dot, space, underscore, slash. */
const SEP = "[-. _/]";
/** `ddd-dd-dddd` with any separator, anywhere in the value but not inside a longer digit run. */
const SSN_SEPARATED = new RegExp(`(?<!\\d)\\d{3}${SEP}\\d{2}${SEP}\\d{4}(?!\\d)`);
/**
 * Any run of exactly nine digits, wherever it sits in the value (`A123456789`, `MRN 123456789`).
 * Allowed only when the operator recorded "MRNs are 9 digits".
 */
const SSN_NINE_DIGITS = /(?<!\d)\d{9}(?!\d)/;

/**
 * CMS Medicare Beneficiary Identifier format (11 characters; position 1 a digit 1-9, 2 a letter,
 * 3 a letter or digit, 4 a digit, 5 a letter, 6 a letter or digit, 7 a digit, 8 and 9 letters, 10 and
 * 11 digits; the letters S, L, O, I, B and Z are never used). ⚠️ VERIFY against the CMS "MBI format"
 * publication (https://www.cms.gov/medicare/new-medicare-card/understanding-the-mbi.pdf) before the
 * first real practice. The display form groups it 4-3-4. Matched as a token anywhere in the value
 * (compact, or grouped with any separator), on the upper-cased value.
 */
const MBI_ALPHA = "AC-HJKMNP-RT-Y";
const MBI_BODY = `[1-9][${MBI_ALPHA}][${MBI_ALPHA}0-9][0-9][${MBI_ALPHA}][${MBI_ALPHA}0-9][0-9][${MBI_ALPHA}]{2}[0-9]{2}`;
const MBI_COMPACT = new RegExp(`(?<![A-Z0-9])${MBI_BODY}(?![A-Z0-9])`);
const MBI_EXACT = new RegExp(`^${MBI_BODY}$`);
const MBI_GROUPED = new RegExp(`(?<![A-Z0-9])[A-Z0-9]{4}${SEP}[A-Z0-9]{3}${SEP}[A-Z0-9]{4}(?![A-Z0-9])`, "g");

function looksLikeMbi(value: string): boolean {
  const upper = value.toUpperCase();
  if (MBI_COMPACT.test(upper)) return true;
  return [...upper.matchAll(MBI_GROUPED)].some((match) => MBI_EXACT.test(match[0].replace(/[-. _/]/g, "")));
}

/**
 * The refusal code for an SSN- or MBI-shaped MRN value, or null. Judged on the whole value, wherever the
 * shape sits (a `SYN-` marker or a vendor prefix doesn't hide it): a nine-digit run is refused unless
 * `nineDigitsVerified` (the operator confirmed at approval that this practice's MRNs really are nine
 * digits, `mrn_nine_digits_verified`); an SSN grouped 3-2-4 with any separator, and an MBI, are refused always.
 */
export function mrnShapeProblem(
  value: string,
  options: { nineDigitsVerified: boolean },
): MrnShapeCode | null {
  if (SSN_SEPARATED.test(value)) return "mrn_looks_like_ssn";
  if (SSN_NINE_DIGITS.test(value) && !options.nineDigitsVerified) return "mrn_looks_like_ssn";
  if (looksLikeMbi(value)) return "mrn_looks_like_mbi";
  return null;
}
