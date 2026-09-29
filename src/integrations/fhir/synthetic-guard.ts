// The raw `SYN` guard (docs/specs/patient-integrations.md "Environment and population rules";
// threat model I9; ADR 0010). Where only synthetic data is allowed (`syntheticDataOnly()`: local, CI,
// every Netlify deploy), every raw MRN and member ID that the sync would ingest must start with
// `SYN`, and this runs on the parsed-JSON page **before any transform** (before the mapper, before
// the database). One failing value fails the whole page, the page is rolled back, and the run fails
// with `not_synthetic`. There is no prefixing on ingest: a vendor sandbox whose identifiers lack the
// marker stays unusable until the owner decides how its synthetic origin is proven (OA-049).
//
// It reads the raw JSON defensively (never through the mapper's schemas): the point is to see the
// value the server sent, whatever its shape, and to say nothing about it.

export const SYNTHETIC_MARKER = "SYN";

/** Thrown when a page carries an identifier that is not marked synthetic. Carries no value. */
export class NotSyntheticError extends Error {
  constructor() {
    super("not_synthetic");
    this.name = "NotSyntheticError";
  }
}

export function isNotSyntheticError(error: unknown): error is NotSyntheticError {
  return error instanceof NotSyntheticError;
}

const V2_0203 = "http://terminology.hl7.org/CodeSystem/v2-0203";

function objects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : [];
}

function marked(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(SYNTHETIC_MARKER);
}

function isMemberIdentifier(identifier: Record<string, unknown>): boolean {
  const type = identifier.type;
  if (typeof type !== "object" || type === null) return false;
  return objects((type as Record<string, unknown>).coding).some(
    (coding) => coding.system === V2_0203 && coding.code === "MB",
  );
}

/**
 * Throws `NotSyntheticError` unless every MRN (an identifier of the connection's MRN system) on the
 * raw Patient resources and every member ID (an `MB`-typed identifier, or `subscriberId`) on the raw
 * Coverage resources starts with `SYN`. A value that is absent is not checked here (the mapper skips
 * it); a value that is present but not a string fails.
 */
export function assertSyntheticPage(
  patients: readonly unknown[],
  coverages: readonly unknown[],
  mrnSystem: string,
): void {
  for (const patient of objects(patients)) {
    for (const identifier of objects(patient.identifier)) {
      if (identifier.system === mrnSystem && identifier.value !== undefined && !marked(identifier.value)) {
        throw new NotSyntheticError();
      }
    }
  }
  for (const coverage of objects(coverages)) {
    if (coverage.subscriberId !== undefined && !marked(coverage.subscriberId)) throw new NotSyntheticError();
    for (const identifier of objects(coverage.identifier)) {
      if (isMemberIdentifier(identifier) && identifier.value !== undefined && !marked(identifier.value)) {
        throw new NotSyntheticError();
      }
    }
  }
}
