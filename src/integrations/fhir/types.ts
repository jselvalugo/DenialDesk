import { z } from "zod";
import { runCodeForIssueType } from "./sync-codes";

// The parts of FHIR R4 / US Core 6.1.0 Bundle, Patient and Coverage that the sync reads
// (docs/specs/patient-integrations.md "Field mapping"; https://hl7.org/fhir/R4/bundle.html,
// https://hl7.org/fhir/us/core/STU6.1/). An allow-list, not a model of the resources: every schema
// drops fields it doesn't name, so telecom, e-mail, race, ethnicity, contacts and clinical data can
// never reach the mapper, the log, or the database (minimum necessary, R-5.1.2; threat model I2).
// Array and string lengths are capped so one resource can't cost more than a bounded amount of work.

const short = z.string().max(256);
const url = z.string().max(2048);
const FEW = 50;

const codingSchema = z.object({ system: url.optional(), code: z.string().max(128).optional() });
const codeableConcept = z.object({ coding: z.array(codingSchema).max(FEW).optional() });

const identifierSchema = z.object({
  system: url.optional(),
  value: short.optional(),
  type: codeableConcept.optional(),
});

const humanNameSchema = z.object({
  use: z.string().max(32).optional(),
  family: short.optional(),
  given: z.array(short).max(FEW).optional(),
});

const periodSchema = z.object({ start: z.string().max(64).optional(), end: z.string().max(64).optional() });

const addressSchema = z.object({
  use: z.string().max(32).optional(),
  line: z.array(short).max(FEW).optional(),
  city: short.optional(),
  state: short.optional(),
  postalCode: z.string().max(32).optional(),
  period: periodSchema.optional(),
});

export const patientResourceSchema = z.object({
  resourceType: z.literal("Patient"),
  id: z.string().max(128).optional(),
  meta: z
    .object({
      versionId: z.string().max(128).optional(),
      lastUpdated: z.string().max(64).optional(),
      security: z.array(codingSchema).max(FEW).optional(),
    })
    .optional(),
  identifier: z.array(identifierSchema).max(FEW).optional(),
  active: z.boolean().optional(),
  name: z.array(humanNameSchema).max(FEW).optional(),
  gender: z.string().max(32).optional(),
  birthDate: z.string().max(32).optional(),
  address: z.array(addressSchema).max(FEW).optional(),
  link: z
    .array(
      z.object({
        type: z.string().max(32).optional(),
        other: z.object({ reference: url.optional() }).optional(),
      }),
    )
    .max(FEW)
    .optional(),
});
export type PatientResource = z.infer<typeof patientResourceSchema>;

export const coverageResourceSchema = z.object({
  resourceType: z.literal("Coverage"),
  id: z.string().max(128).optional(),
  status: z.string().max(32).optional(),
  identifier: z.array(identifierSchema).max(FEW).optional(),
  subscriberId: short.optional(),
  beneficiary: z.object({ reference: url.optional() }).optional(),
  relationship: codeableConcept.optional(),
  period: periodSchema.optional(),
  order: z.number().int().optional(),
  payor: z
    .array(z.object({ reference: url.optional(), display: short.optional() }))
    .max(FEW)
    .optional(),
});
export type CoverageResource = z.infer<typeof coverageResourceSchema>;

/** The Bundle envelope only; each entry's resource is validated on its own, so one bad record skips itself. */
export const bundleSchema = z.object({
  resourceType: z.literal("Bundle"),
  type: z.string().max(32).optional(),
  meta: z.object({ lastUpdated: z.string().max(64).optional() }).optional(),
  link: z
    .array(z.object({ relation: z.string().max(32), url }))
    .max(FEW)
    .optional(),
  entry: z
    .array(
      z.object({
        resource: z.unknown().optional(),
        search: z.object({ mode: z.string().max(16).optional() }).optional(),
      }),
    )
    // Deliberately no `.max()` here: the entry cap is `assertBundleEntryLimit` (limits.ts), which
    // fails the run with `too_large` instead of a schema error that would read as a bad response.
    .optional(),
});
export type FhirBundle = z.infer<typeof bundleSchema>;

const operationOutcomeSchema = z.object({
  resourceType: z.literal("OperationOutcome"),
  // `diagnostics`, `details` and `expression` are never read: they can echo a request, a URL, or PHI.
  issue: z
    .array(z.object({ code: z.string().max(64).optional() }))
    .max(FEW)
    .optional(),
});

/**
 * The stored codes of an OperationOutcome: each `issue.code` is mapped onto our own vocabulary
 * (`runCodeForIssueType`, `sync-codes.ts`): ours if it is exactly an R4 IssueType code, in our
 * underscore spelling, else `other`. The remote string is never stored. `diagnostics` is never read,
 * stored or logged.
 */
export function operationOutcomeCodes(resource: unknown): string[] {
  const parsed = operationOutcomeSchema.safeParse(resource);
  if (!parsed.success) return [];
  return [...new Set((parsed.data.issue ?? []).map((issue) => runCodeForIssueType(issue.code)))];
}
