import { z } from "zod";
import { SYNTHETIC_MARKER } from "@/domain/synthetic/generator";

// Patient record input (docs/specs/patients.md). Validated here and again by CHECKs in the database.

/** Record-level sensitivity tags (R-3.5.1). Enforcement in queries and masking is phase P4. */
export const SENSITIVITY_TAGS = {
  hiv: "HIV",
  mental_health: "Mental health",
  sud: "Substance use (42 CFR Part 2)",
  genetic: "Genetic testing",
  minor: "Minor",
  reproductive_health: "Reproductive health",
} as const;

export type SensitivityTag = keyof typeof SENSITIVITY_TAGS;

export const SEX_LABELS = { F: "Female", M: "Male", U: "Unknown" } as const;

/** Every field of the form, in the order the audit trail lists changes. */
export const PATIENT_FIELD_LABELS = {
  mrn: "MRN",
  firstName: "First name",
  lastName: "Last name",
  birthDate: "Date of birth",
  sex: "Sex",
  addressLine1: "Address",
  city: "City",
  state: "State",
  postalCode: "ZIP",
  phone: "Phone",
  primaryPayerId: "Primary payer",
  memberId: "Member ID",
  sensitivityTags: "Sensitivity tags",
} as const;

export type PatientField = keyof typeof PATIENT_FIELD_LABELS;

/** Optional text: trimmed, and blank becomes null. */
const optional = <T extends z.ZodType<string, string>>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    schema.nullable(),
  );

const name = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter the ${label}.`)
    .max(60, `The ${label} can be at most 60 characters.`)
    .regex(
      /^[\p{L}][\p{L} .'-]*$/u,
      `The ${label} can only have letters, spaces, periods, apostrophes, and hyphens.`,
    );

export function patientSchema(options: { today: string; syntheticOnly: boolean }) {
  const synthetic = (label: string) => (value: string) =>
    !options.syntheticOnly ||
    value.toUpperCase().startsWith(SYNTHETIC_MARKER) ||
    `${label} must start with ${SYNTHETIC_MARKER} (synthetic data only).`;
  return z
    .object({
      /** Blank: the system assigns one. */
      mrn: optional(
        z
          .string()
          .trim()
          .toUpperCase()
          .max(40, "The MRN can be at most 40 characters.")
          .regex(/^[A-Z0-9-]+$/, "The MRN can only have letters, digits, and hyphens."),
      ),
      firstName: name("first name"),
      lastName: name("last name"),
      birthDate: z.iso
        .date("Enter a valid date of birth.")
        .refine((d) => d >= "1900-01-01", "Enter a date of birth after 1900.")
        .refine((d) => d <= options.today, "The date of birth can't be in the future."),
      sex: z.enum(["F", "M", "U"], "Choose the patient's sex."),
      addressLine1: optional(z.string().trim().max(100, "The address can be at most 100 characters.")),
      city: optional(z.string().trim().max(60, "The city can be at most 60 characters.")),
      state: optional(
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{2}$/, "Enter the two-letter state."),
      ),
      postalCode: optional(
        z
          .string()
          .trim()
          .regex(/^\d{5}(-\d{4})?$/, "Enter a 5-digit ZIP or ZIP+4."),
      ),
      phone: optional(
        z
          .string()
          .trim()
          .transform((v) => v.replace(/\D/g, ""))
          .pipe(z.string().length(10, "Enter a 10-digit phone number."))
          .transform((d) => `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`),
      ),
      primaryPayerId: optional(z.string().uuid("Choose a payer from the list.")),
      /** Blank on edit keeps the stored member ID. */
      memberId: optional(
        z
          .string()
          .trim()
          .toUpperCase()
          .min(4, "The member ID must be at least 4 characters.")
          .max(30, "The member ID can be at most 30 characters.")
          .regex(/^[A-Z0-9-]+$/, "The member ID can only have letters, digits, and hyphens."),
      ),
      sensitivityTags: z
        .array(z.enum(Object.keys(SENSITIVITY_TAGS) as [SensitivityTag, ...SensitivityTag[]]))
        .transform((tags) => [...new Set(tags)].sort()),
    })
    .superRefine((value, ctx) => {
      for (const field of ["mrn", "memberId"] as const) {
        const v = value[field];
        if (!v) continue;
        const check = synthetic(PATIENT_FIELD_LABELS[field])(v);
        if (check !== true) ctx.addIssue({ code: "custom", path: [field], message: check });
      }
      if (value.memberId && !value.primaryPayerId) {
        ctx.addIssue({
          code: "custom",
          path: ["primaryPayerId"],
          message: "Choose the payer this member ID belongs to.",
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
  for (const field of Object.keys(PATIENT_FIELD_LABELS) as PatientField[]) {
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
