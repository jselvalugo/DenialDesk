import { z } from "zod";
import type { ClaimSnapshot } from "@/db/schema";

// Format checks only. Validity against licensed code sets (AMA CPT, CMS ICD-10-CM) is out of scope
// until those files are licensed and loaded (docs/specs/claims.md).
const CPT_HCPCS = /^[A-Z0-9]{5}$/;
const MODIFIER = /^[A-Z0-9]{2}$/;
const ICD10CM = /^[A-Z][0-9][0-9A-Z](\.?[0-9A-Z]{1,4})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_DIAGNOSES = 12;
export const MAX_MODIFIERS = 4;
export const MAX_REASON_LENGTH = 500;

/** Splits a comma/space separated code list, upper-cased, blanks dropped. */
export function splitCodes(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
}

/** Dollars text ("125", "125.5", "1,250.00") to integer cents; NaN when not a plain amount. */
export function dollarsToCents(text: string): number {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(cleaned)) return Number.NaN;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

const lineSchema = z.object({
  lineNumber: z.number().int().min(1),
  procedureCode: z.string().regex(CPT_HCPCS, "Procedure codes are 5 letters or digits (CPT/HCPCS)."),
  modifiers: z
    .array(z.string().regex(MODIFIER, "Modifiers are 2 letters or digits."))
    .max(MAX_MODIFIERS, `At most ${MAX_MODIFIERS} modifiers per line.`),
  units: z.number().int("Units must be a whole number.").min(1).max(999),
  chargeCents: z
    .number()
    .int("Enter charges as dollars and cents.")
    .min(1, "Charges must be at least $0.01.")
    .max(9_999_999, "Charges must be under $100,000 per line."),
});

export const correctionSchema = z.object({
  serviceDate: z.string().regex(ISO_DATE, "Enter the date of service."),
  diagnosisCodes: z
    .array(z.string().regex(ICD10CM, "Diagnosis codes must be ICD-10-CM format (e.g. E11.9)."))
    .min(1, "Enter at least one diagnosis code.")
    .max(MAX_DIAGNOSES, `At most ${MAX_DIAGNOSES} diagnosis codes.`),
  lines: z.array(lineSchema).min(1),
  reason: z
    .string()
    .trim()
    .min(5, "Say why the claim is being corrected.")
    .max(MAX_REASON_LENGTH, `Keep the reason under ${MAX_REASON_LENGTH} characters.`),
});

export type Correction = z.infer<typeof correctionSchema>;

/** The billed content of a claim as stored in claim_versions (no patient demographics). */
export function snapshotOf(
  claim: { serviceDate: string; diagnosisCodes: string[]; billedCents: number; status: string },
  lines: ClaimSnapshot["lines"],
): ClaimSnapshot {
  return {
    serviceDate: claim.serviceDate,
    diagnosisCodes: [...claim.diagnosisCodes],
    billedCents: claim.billedCents,
    status: claim.status,
    lines: [...lines]
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map((l) => ({
        lineNumber: l.lineNumber,
        procedureCode: l.procedureCode,
        modifiers: [...l.modifiers],
        units: l.units,
        chargeCents: l.chargeCents,
      })),
  };
}

/** Names of the fields that differ between two snapshots, e.g. ["diagnosisCodes", "line 2 units"]. */
export function changedFields(before: ClaimSnapshot, after: ClaimSnapshot): string[] {
  const changes: string[] = [];
  if (before.serviceDate !== after.serviceDate) changes.push("serviceDate");
  if (before.diagnosisCodes.join(",") !== after.diagnosisCodes.join(",")) changes.push("diagnosisCodes");
  for (const line of after.lines) {
    const old = before.lines.find((l) => l.lineNumber === line.lineNumber);
    if (!old) {
      changes.push(`line ${line.lineNumber}`);
      continue;
    }
    if (old.procedureCode !== line.procedureCode) changes.push(`line ${line.lineNumber} procedureCode`);
    if (old.modifiers.join(",") !== line.modifiers.join(","))
      changes.push(`line ${line.lineNumber} modifiers`);
    if (old.units !== line.units) changes.push(`line ${line.lineNumber} units`);
    if (old.chargeCents !== line.chargeCents) changes.push(`line ${line.lineNumber} chargeCents`);
  }
  return changes;
}

/** Plain-language label for a changed-field name. */
export function describeChange(field: string): string {
  const labels: Record<string, string> = {
    serviceDate: "date of service",
    diagnosisCodes: "diagnosis codes",
    procedureCode: "procedure",
    modifiers: "modifiers",
    units: "units",
    chargeCents: "charge",
  };
  const line = /^line (\d+)(?: (\w+))?$/.exec(field);
  if (line) return `line ${line[1]}${line[2] ? ` ${labels[line[2]] ?? line[2]}` : ""}`;
  return labels[field] ?? field;
}

export interface SnapshotChange {
  label: string;
  from: string;
  to: string;
}

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** What changed between two versions, for the claim history (R-3.10.3). */
export function diffSnapshots(before: ClaimSnapshot, after: ClaimSnapshot): SnapshotChange[] {
  const list = (codes: string[]) => codes.join(", ") || "none";
  return changedFields(before, after).map((field) => {
    const label = describeChange(field);
    if (field === "serviceDate") return { label, from: before.serviceDate, to: after.serviceDate };
    if (field === "diagnosisCodes")
      return { label, from: list(before.diagnosisCodes), to: list(after.diagnosisCodes) };
    const [, n, key] = /^line (\d+)(?: (\w+))?$/.exec(field)!;
    const old = before.lines.find((l) => l.lineNumber === Number(n));
    const now = after.lines.find((l) => l.lineNumber === Number(n))!;
    const show = (line: ClaimSnapshot["lines"][number] | undefined): string => {
      if (!line) return "none";
      if (key === "modifiers") return list(line.modifiers);
      if (key === "units") return String(line.units);
      if (key === "chargeCents") return money(line.chargeCents);
      if (key === "procedureCode") return line.procedureCode;
      return `${line.procedureCode} × ${line.units}`;
    };
    return { label, from: show(old), to: show(now) };
  });
}
