import { INVISIBLE_CHARS } from "./identifier-rules";
import { coverageResourceSchema, type CoverageResource } from "./types";

// Primary Coverage selection (docs/specs/patient-integrations.md "Field mapping"; US Core 6.1.0
// Coverage https://hl7.org/fhir/us/core/STU6.1/StructureDefinition-us-core-coverage.html).
//
// Primary Coverage = active, beneficiary this patient, period covering today, lowest `order`,
// relationship `self`. Ties with no `order`, dependents (OA-055), or a non-Organization payor mean
// `needs_review`: no payer, no member ID. The payer itself is never guessed (CLAUDE.md non-negotiable
// 9): it is set only by an explicit administrator mapping of the payor key, applied by the caller.
// Pure: nothing here logs or returns a value from a resource that is not selected.

export type CoverageStatus = "none" | "mapped" | "unmapped" | "needs_review";

export interface CoverageSelection {
  /** `mapped` is decided by the caller (it holds the payer mappings); this returns `unmapped` for a usable coverage. */
  status: Exclude<CoverageStatus, "mapped">;
  /** `Organization/<id>` of the selected coverage's payor; null unless usable. */
  payorKey: string | null;
  /** `payor.display`, when the server sent one; a label for the mapping page only. */
  payorName: string | null;
  /** Plaintext for the caller to encrypt at once; null unless usable. Never logged, never audited. */
  memberId: string | null;
}

const NONE: CoverageSelection = { status: "none", payorKey: null, payorName: null, memberId: null };
const NEEDS_REVIEW: CoverageSelection = {
  status: "needs_review",
  payorKey: null,
  payorName: null,
  memberId: null,
};

const V2_0203 = "http://terminology.hl7.org/CodeSystem/v2-0203";
const SUBSCRIBER_RELATIONSHIP = "http://terminology.hl7.org/CodeSystem/subscriber-relationship";
const MEMBER_ID = /^[\x20-\x7e]{1,64}$/;
const PATIENT_REFERENCE = /(?:^|\/)Patient\/([A-Za-z0-9\-.]{1,64})(?:\/_history\/[A-Za-z0-9\-.]{1,64})?$/;
const ORGANIZATION_REFERENCE =
  /(?:^|\/)Organization\/([A-Za-z0-9\-.]{1,64})(?:\/_history\/[A-Za-z0-9\-.]{1,64})?$/;
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;
const PAYOR_NAME_MAX = 200;

/** The patient id a Coverage's `beneficiary` points at (`Patient/<id>`, relative or absolute), or null. */
export function beneficiaryId(coverage: CoverageResource): string | null {
  return PATIENT_REFERENCE.exec(coverage.beneficiary?.reference ?? "")?.[1] ?? null;
}

/** The payor key for a reference to an Organization (`Organization/<id>`), or null for anything else. */
export function organizationKey(reference: string | undefined): string | null {
  const id = ORGANIZATION_REFERENCE.exec(reference ?? "")?.[1];
  return id ? `Organization/${id}` : null;
}

/** Whether `today` (`YYYY-MM-DD`) is inside the period. A bound that isn't a date makes the period unusable. */
function coversToday(coverage: CoverageResource, today: string): boolean {
  const { start, end } = coverage.period ?? {};
  if (start !== undefined && (!ISO_DATE_PREFIX.test(start) || start.slice(0, 10) > today)) return false;
  if (end !== undefined && (!ISO_DATE_PREFIX.test(end) || end.slice(0, 10) < today)) return false;
  return true;
}

function isSelf(coverage: CoverageResource): boolean {
  return (coverage.relationship?.coding ?? []).some(
    (coding) => coding.system === SUBSCRIBER_RELATIONSHIP && coding.code === "self",
  );
}

/** Member ID: the identifier of type MB, else `subscriberId` (spec). Null when absent or unusable. */
export function memberIdOf(coverage: CoverageResource): string | null {
  const typed = (coverage.identifier ?? []).find((identifier) =>
    (identifier.type?.coding ?? []).some((coding) => coding.system === V2_0203 && coding.code === "MB"),
  );
  const value = (typed?.value ?? coverage.subscriberId ?? "").trim();
  return MEMBER_ID.test(value) && !INVISIBLE_CHARS.test(value) ? value : null;
}

/**
 * Chooses the patient's primary coverage among the Coverage resources the server returned for it.
 * `externalId` is the `Patient.id`; a coverage whose beneficiary is someone else is ignored (a search
 * by several patients returns them all in one Bundle). `raw` entries that aren't Coverage are ignored.
 */
export function selectPrimaryCoverage(
  raw: readonly unknown[],
  externalId: string,
  today: string,
): CoverageSelection {
  const candidates = raw
    .map((entry) => coverageResourceSchema.safeParse(entry))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
    .filter(
      (coverage) =>
        coverage.status === "active" &&
        beneficiaryId(coverage) === externalId &&
        coversToday(coverage, today),
    );
  if (candidates.length === 0) return NONE;

  // Lowest `order` wins; a tie at the lowest (including several with no order at all) is not ours to
  // break: an administrator reviews it in the EHR.
  const orders = candidates.map((coverage) => coverage.order ?? Number.POSITIVE_INFINITY);
  const lowest = Math.min(...orders);
  const best = candidates.filter((_, index) => orders[index] === lowest);
  if (best.length !== 1) return NEEDS_REVIEW;
  const chosen = best[0]!;

  // Dependents are OA-055; a missing relationship is treated the same way (fail toward review).
  if (!isSelf(chosen)) return NEEDS_REVIEW;
  if ((chosen.payor ?? []).length !== 1) return NEEDS_REVIEW;
  const payor = chosen.payor![0]!;
  const payorKey = organizationKey(payor.reference);
  if (!payorKey) return NEEDS_REVIEW;
  const memberId = memberIdOf(chosen);
  if (!memberId) return NEEDS_REVIEW;

  const display = (payor.display ?? "").trim();
  return {
    status: "unmapped",
    payorKey,
    payorName:
      display !== "" && display.length <= PAYOR_NAME_MAX && !INVISIBLE_CHARS.test(display) ? display : null,
    memberId,
  };
}
