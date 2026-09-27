import { z } from "zod";
import { en } from "@/i18n/messages/en";
import type { MessageKey, Messages } from "@/i18n/messages/types";
import { createTranslator, type Translator } from "@/i18n/translate";
import { SYNTHETIC_MARKER } from "@/domain/synthetic/generator";

// Patient record input (docs/specs/patients.md). Validated here and again by CHECKs in the database.

type PatientsKey = MessageKey<"patients">;
type PatientsT = Translator<Messages["patients"]>;

/** English translator used when a caller doesn't have the request's language (e.g. unit tests). */
const englishPatientsT: PatientsT = createTranslator(en.patients, "en");

/** Record-level sensitivity tags (R-3.5.1). Enforcement in queries and masking is phase P4. */
export const SENSITIVITY_TAG_LABEL_KEYS = {
  hiv: "sensitivity.hiv",
  mental_health: "sensitivity.mentalHealth",
  sud: "sensitivity.sud",
  genetic: "sensitivity.genetic",
  minor: "sensitivity.minor",
  reproductive_health: "sensitivity.reproductiveHealth",
} as const satisfies Record<string, PatientsKey>;

export type SensitivityTag = keyof typeof SENSITIVITY_TAG_LABEL_KEYS;

export function sensitivityTagLabel(tag: SensitivityTag, t: PatientsT = englishPatientsT): string {
  return t(SENSITIVITY_TAG_LABEL_KEYS[tag]);
}

export const SEX_LABEL_KEYS = { F: "sex.female", M: "sex.male", U: "sex.unknown" } as const satisfies Record<
  string,
  PatientsKey
>;

export function sexLabel(sex: keyof typeof SEX_LABEL_KEYS, t: PatientsT = englishPatientsT): string {
  return t(SEX_LABEL_KEYS[sex]);
}

/** Every field of the form, in the order the audit trail lists changes. Values are message keys. */
export const PATIENT_FIELD_LABEL_KEYS = {
  mrn: "field.mrn",
  firstName: "field.firstName",
  lastName: "field.lastName",
  birthDate: "field.birthDate",
  sex: "field.sex",
  addressLine1: "field.address",
  city: "field.city",
  state: "field.state",
  postalCode: "field.zip",
  phone: "field.phone",
  primaryPayerId: "field.primaryPayer",
  memberId: "field.memberId",
  sensitivityTags: "field.sensitivityTags",
} as const satisfies Record<string, PatientsKey>;

export type PatientField = keyof typeof PATIENT_FIELD_LABEL_KEYS;

export function patientFieldLabel(field: PatientField, t: PatientsT = englishPatientsT): string {
  return t(PATIENT_FIELD_LABEL_KEYS[field]);
}

/** Optional text: trimmed, and blank becomes null. */
const optional = <T extends z.ZodType<string, string>>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    schema.nullable(),
  );

/** A person's name field: required, length-bounded, and letters/spaces/punctuation only. */
function name(t: PatientsT, keys: { required: PatientsKey; maxLength: PatientsKey; format: PatientsKey }) {
  return z
    .string()
    .trim()
    .min(1, t(keys.required))
    .max(60, t(keys.maxLength, { max: 60 }))
    .regex(/^[\p{L}][\p{L} .'-]*$/u, t(keys.format));
}

export function patientSchema(
  options: { today: string; syntheticOnly: boolean },
  t: PatientsT = englishPatientsT,
) {
  const synthetic = (field: PatientField) => (value: string) =>
    !options.syntheticOnly ||
    value.toUpperCase().startsWith(SYNTHETIC_MARKER) ||
    t("validation.syntheticPrefix", { field: patientFieldLabel(field, t), marker: SYNTHETIC_MARKER });
  return z
    .object({
      /** Blank: the system assigns one. */
      mrn: optional(
        z
          .string()
          .trim()
          .toUpperCase()
          .max(40, t("validation.mrnMaxLength", { max: 40 }))
          .regex(/^[A-Z0-9-]+$/, t("validation.mrnFormat")),
      ),
      firstName: name(t, {
        required: "validation.enterFirstName",
        maxLength: "validation.firstNameMaxLength",
        format: "validation.firstNameFormat",
      }),
      lastName: name(t, {
        required: "validation.enterLastName",
        maxLength: "validation.lastNameMaxLength",
        format: "validation.lastNameFormat",
      }),
      birthDate: z.iso
        .date(t("validation.birthDateInvalid"))
        .refine((d) => d >= "1900-01-01", t("validation.birthDateTooOld"))
        .refine((d) => d <= options.today, t("validation.birthDateFuture")),
      sex: z.enum(["F", "M", "U"], t("validation.chooseSex")),
      addressLine1: optional(
        z
          .string()
          .trim()
          .max(100, t("validation.addressMaxLength", { max: 100 })),
      ),
      city: optional(
        z
          .string()
          .trim()
          .max(60, t("validation.cityMaxLength", { max: 60 })),
      ),
      state: optional(
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{2}$/, t("validation.stateFormat")),
      ),
      postalCode: optional(
        z
          .string()
          .trim()
          .regex(/^\d{5}(-\d{4})?$/, t("validation.postalFormat")),
      ),
      phone: optional(
        z
          .string()
          .trim()
          .transform((v) => v.replace(/\D/g, ""))
          .pipe(z.string().length(10, t("validation.phoneFormat")))
          .transform((d) => `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`),
      ),
      primaryPayerId: optional(z.string().uuid(t("error.choosePayer"))),
      /** Blank on edit keeps the stored member ID. */
      memberId: optional(
        z
          .string()
          .trim()
          .toUpperCase()
          .min(4, t("validation.memberIdMinLength", { min: 4 }))
          .max(30, t("validation.memberIdMaxLength", { max: 30 }))
          .regex(/^[A-Z0-9-]+$/, t("validation.memberIdFormat")),
      ),
      sensitivityTags: z
        .array(z.enum(Object.keys(SENSITIVITY_TAG_LABEL_KEYS) as [SensitivityTag, ...SensitivityTag[]]))
        .transform((tags) => [...new Set(tags)].sort()),
    })
    .superRefine((value, ctx) => {
      for (const field of ["mrn", "memberId"] as const) {
        const v = value[field];
        if (!v) continue;
        const check = synthetic(field)(v);
        if (check !== true) ctx.addIssue({ code: "custom", path: [field], message: check });
      }
      if (value.memberId && !value.primaryPayerId) {
        ctx.addIssue({
          code: "custom",
          path: ["primaryPayerId"],
          message: t("validation.memberIdNeedsPayer"),
        });
      }
    });
}

export type PatientInput = z.infer<ReturnType<typeof patientSchema>>;

/** Stored values a form edit is compared against (the member ID only as its last 4). */
export interface StoredPatient {
  mrn: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  sex: "F" | "M" | "U";
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  primaryPayerId: string | null;
  sensitivityTags: string[];
}

/** Field names that differ (values never leave this function: the audit trail stores names only). */
export function changedPatientFields(
  before: StoredPatient,
  after: Omit<PatientInput, "sensitivityTags"> & { sensitivityTags: string[] },
): PatientField[] {
  const changed: PatientField[] = [];
  for (const field of Object.keys(PATIENT_FIELD_LABEL_KEYS) as PatientField[]) {
    if (field === "memberId") {
      if (after.memberId) changed.push(field);
      continue;
    }
    if (field === "mrn" && !after.mrn) continue;
    if (field === "sensitivityTags") {
      if ([...before.sensitivityTags].sort().join(",") !== after.sensitivityTags.join(","))
        changed.push(field);
      continue;
    }
    if ((before[field] ?? null) !== (after[field] ?? null)) changed.push(field);
  }
  return changed;
}

/** Next generated MRN for a practice, from the highest numeric suffix among existing MRNs. */
export function nextMrn(existing: string[], syntheticOnly: boolean): string {
  const prefix = syntheticOnly ? `${SYNTHETIC_MARKER}-` : "MRN-";
  const highest = existing
    .filter((mrn) => mrn.startsWith(prefix) && /^\d+$/.test(mrn.slice(prefix.length)))
    .map((mrn) => Number(mrn.slice(prefix.length)))
    .filter((n) => Number.isSafeInteger(n))
    .reduce((max, n) => Math.max(max, n), 0);
  return `${prefix}${String(highest + 1).padStart(6, "0")}`;
}

/** "Last, First" as shown across the app. */
export function patientName(p: { firstName: string; lastName: string }): string {
  return `${p.lastName}, ${p.firstName}`;
}

/**
 * Whole years between a date of birth and `today` (both YYYY-MM-DD), or null when either is not a
 * date or the birth date is later than today. Display only; never a legal clock.
 */
export function ageOn(birthDate: string, today: string): number | null {
  const parse = (iso: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const b = parse(birthDate);
  const t = parse(today);
  if (!b || !t) return null;
  let age = t[0]! - b[0]!;
  if (t[1]! < b[1]! || (t[1] === b[1] && t[2]! < b[2]!)) age -= 1;
  return age < 0 ? null : age;
}
