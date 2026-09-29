import { INVISIBLE_CHARS } from "./identifier-rules";
import { mrnShapeProblem } from "./mrn-shapes";
import { classifySecurityLabels } from "./security-labels";
import type { NoteCode, SkipCode } from "./sync-codes";
import { patientResourceSchema, type PatientResource } from "./types";

// FHIR R4 / US Core 6.1.0 Patient -> the `patients` billing minimum (docs/specs/patient-integrations.md
// "Field mapping"). A pure function: it reads only the allow-listed fields, applies the spec's
// required rules, and either returns the mapped record or **skips it with a code**. It never
// partially guesses (a record failing a required rule is not stored with a blank), and it never
// returns or logs a value from a rejected record. Coverage is mapped separately (`map-coverage.ts`).

export type { NoteCode, SkipCode } from "./sync-codes";

export interface MappedPatient {
  /** `Patient.id`, FHIR `id` syntax, at most 64 characters. */
  externalId: string;
  sourceVersionId: string | null;
  /** `meta.lastUpdated`, clamped to our clock plus the skew allowance. */
  sourceLastUpdated: Date | null;
  mrn: string;
  firstName: string;
  lastName: string;
  /** `YYYY-MM-DD`. */
  birthDate: string;
  sex: "F" | "M" | "U";
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  sourceStatus: "inactive" | "merged" | null;
  sourceRestricted: boolean;
  sourceSensitivity: string[];
}

export type MapPatientResult =
  | { ok: true; patient: MappedPatient; notes: NoteCode[] }
  | {
      ok: false;
      code: SkipCode;
      /** The `Patient.id` when it is well-formed, so an issue can name it. */ externalId?: string;
    };

export interface MapPatientContext {
  /** The connection's `mrn_identifier_system`. */
  mrnSystem: string;
  /** `mrn_nine_digits_verified`: bare nine-digit MRNs are allowed (the operator confirmed it). */
  nineDigitsVerified: boolean;
  /** Our clock. Never the server's: clamping comes from here. */
  now: Date;
  /**
   * "Today" as a practice date, `YYYY-MM-DD` in America/New_York (`todayIn`, `rules/calendar.ts`), never
   * the UTC date: at 23:30 Eastern the UTC date is already tomorrow, which would age a patient a day,
   * end a coverage period a day early and start one a day early.
   */
  today: string;
}

/** "Server timestamps are clamped (future beyond 5 min skew -> our now)" (spec, threat model T4). */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const FHIR_ID = /^[A-Za-z0-9\-.]{1,64}$/;
const V2_0203 = "http://terminology.hl7.org/CodeSystem/v2-0203";
/** v2-0203 identifier types that are never a medical record number: SSN, MBI, Medicare, DL, passport. */
const GOVERNMENT_TYPES = new Set(["SS", "MB", "MC", "DL", "PPN"]);
// `patients_mrn_present` (drizzle/0018): 1 to 40 characters. A longer value would fail the INSERT.
const MRN_VALUE = /^[\x21-\x7e]{1,40}$/;
const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PARTIAL_DATE = /^\d{4}(-\d{2})?$/;
const MIN_BIRTH_DATE = "1900-01-01";
// `patients_names_present` (drizzle/0018): 1 to 60 characters each.
const NAME_MAX = 60;
// 837P segment maxima: N301 55, N401 30 (⚠️ VERIFY with the edi-x12-specialist).
const ADDRESS_LINE_MAX = 55;
const CITY_MAX = 30;

/** Whether `YYYY-MM-DD` is a real calendar date (no month 13, no 31 February). */
function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** `meta.lastUpdated` as an instant clamped to `now + skew`; null when absent or not a date-time. */
export function clampServerInstant(raw: string | undefined, now: Date): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS ? new Date(now.getTime()) : parsed;
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

function hasInvisible(value: string): boolean {
  return INVISIBLE_CHARS.test(value);
}

function chooseMrn(resource: PatientResource, ctx: MapPatientContext): { value: string } | SkipCode {
  const matching = (resource.identifier ?? []).filter((identifier) => identifier.system === ctx.mrnSystem);
  const values = new Set(
    matching.map((identifier) => clean(identifier.value)).filter((value) => value !== ""),
  );
  if (values.size === 0) return "mrn_missing";
  if (values.size > 1) return "mrn_ambiguous";
  // The identifier's declared type, whatever its system: a government identifier is never an MRN.
  for (const identifier of matching) {
    const codings = identifier.type?.coding ?? [];
    if (codings.some((coding) => coding.system === V2_0203 && GOVERNMENT_TYPES.has(coding.code ?? ""))) {
      return "mrn_government_identifier";
    }
  }
  const [value] = [...values];
  if (!MRN_VALUE.test(value!)) return "mrn_invalid";
  const shape = mrnShapeProblem(value!, { nineDigitsVerified: ctx.nineDigitsVerified });
  return shape ?? { value: value! };
}

function chooseName(resource: PatientResource): { first: string; last: string } | SkipCode {
  const names = resource.name ?? [];
  const chosen =
    names.find((name) => name.use === "official") ??
    names.find((name) => name.use === "usual") ??
    (names.length === 1 ? names[0] : undefined);
  const first = clean(chosen?.given?.[0]);
  const last = clean(chosen?.family);
  if (first === "" || last === "") return "name_incomplete";
  if (first.length > NAME_MAX || last.length > NAME_MAX || hasInvisible(first) || hasInvisible(last)) {
    return "name_invalid";
  }
  return { first, last };
}

function chooseBirthDate(resource: PatientResource, today: string): { date: string } | SkipCode {
  const raw = clean(resource.birthDate);
  if (raw === "" || PARTIAL_DATE.test(raw)) return "birthdate_incomplete";
  const match = FULL_DATE.exec(raw);
  if (!match || !isRealDate(Number(match[1]), Number(match[2]), Number(match[3]))) return "birthdate_invalid";
  if (raw < MIN_BIRTH_DATE || raw > today) return "birthdate_invalid";
  return { date: raw };
}

interface MappedAddress {
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
}
const NO_ADDRESS: MappedAddress = { addressLine1: null, city: null, state: null, postalCode: null };

/** "home or no use, current"; any missing or invalid part means all four are null (never half an address). */
function chooseAddress(resource: PatientResource, today: string): MappedAddress | null {
  const candidate = (resource.address ?? []).find((address) => {
    if (address.use !== undefined && address.use !== "home") return false;
    const end = address.period?.end?.slice(0, 10);
    const start = address.period?.start?.slice(0, 10);
    return (end === undefined || end >= today) && (start === undefined || start <= today);
  });
  if (!candidate) return null;
  const line1 = clean(candidate.line?.[0]);
  const city = clean(candidate.city);
  const state = clean(candidate.state).toUpperCase();
  const postal = clean(candidate.postalCode);
  const valid =
    line1 !== "" &&
    line1.length <= ADDRESS_LINE_MAX &&
    !hasInvisible(line1) &&
    city !== "" &&
    city.length <= CITY_MAX &&
    !hasInvisible(city) &&
    /^[A-Z]{2}$/.test(state) &&
    /^\d{5}(-\d{4})?$/.test(postal);
  return valid ? { addressLine1: line1, city, state, postalCode: postal } : null;
}

function isMinor(birthDate: string, today: string): boolean {
  const eighteenth = `${Number(birthDate.slice(0, 4)) + 18}${birthDate.slice(4)}`;
  return eighteenth > today;
}

function sourceStatusOf(resource: PatientResource): "inactive" | "merged" | null {
  if ((resource.link ?? []).some((link) => link.type === "replaced-by")) return "merged";
  return resource.active === false ? "inactive" : null;
}

/**
 * Maps one `Patient` entry. `raw` is whatever the server sent inside `entry.resource`; a value that
 * isn't a Patient (or that fails the allow-list schema) is skipped `resource_invalid`, and the schema
 * error itself is never returned or logged.
 */
export function mapPatient(raw: unknown, ctx: MapPatientContext): MapPatientResult {
  const parsed = patientResourceSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "resource_invalid" };
  const resource = parsed.data;
  if (resource.id === undefined || !FHIR_ID.test(resource.id)) return { ok: false, code: "id_invalid" };
  const externalId = resource.id;
  const skip = (code: SkipCode): MapPatientResult => ({ ok: false, code, externalId });

  const { today } = ctx;
  const mrn = chooseMrn(resource, ctx);
  if (typeof mrn === "string") return skip(mrn);
  const name = chooseName(resource);
  if (typeof name === "string") return skip(name);
  const birthDate = chooseBirthDate(resource, today);
  if (typeof birthDate === "string") return skip(birthDate);

  const notes: NoteCode[] = [];
  const address = chooseAddress(resource, today);
  if (!address) notes.push("address_incomplete");
  if (isMinor(birthDate.date, today)) notes.push("review_required");

  const labels = classifySecurityLabels(resource.meta?.security);
  const versionId = resource.meta?.versionId;
  return {
    ok: true,
    notes,
    patient: {
      externalId,
      sourceVersionId: versionId !== undefined && FHIR_ID.test(versionId) ? versionId : null,
      sourceLastUpdated: clampServerInstant(resource.meta?.lastUpdated, ctx.now),
      mrn: mrn.value,
      firstName: name.first,
      lastName: name.last,
      birthDate: birthDate.date,
      sex: resource.gender === "female" ? "F" : resource.gender === "male" ? "M" : "U",
      ...(address ?? NO_ADDRESS),
      sourceStatus: sourceStatusOf(resource),
      sourceRestricted: labels.restricted,
      sourceSensitivity: labels.sensitivity,
    },
  };
}
