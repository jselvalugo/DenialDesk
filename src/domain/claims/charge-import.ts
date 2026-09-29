import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Regime } from "@rules/types";
import { canImportCharges } from "@/auth/permissions";
import { claimLines, claims, locations, patients, payers, providers } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { resolvePayerByName, type PayerOption } from "@/domain/payers/resolve";
import { isPayerVerified } from "@/domain/payers/verification";
import { audit } from "@/lib/audit";
import {
  columnLabel,
  DUPLICATE_CODES,
  lineServiceKey,
  MAX_REPORT_PROBLEMS,
  type ChargeClaim,
  type ChargeColumnKey,
  type ChargeProblem,
  type ChargeProblemCode,
} from "./charge-file";
import { filingStatus } from "./status";
import { CHARGE_IMPORT_REASON, createDraftClaims, type DraftClaimInput } from "./versions";

/**
 * Charge capture import (docs/specs/claims.md C2): matches an already-parsed file against the
 * practice's own patients, payers, providers, and locations, refuses duplicates, and creates draft
 * claims through the C1 domain (`createDraftClaims`, so version 1 and the audit trail apply). It reads
 * patients and never writes one: no patient insert, update, or link exists in this module. All or
 * nothing: any problem means no claim is created. Problems carry codes, line numbers, and column names,
 * never cell values.
 */
export interface ImportActor {
  tenantId: string;
  userId: string;
  role: Parameters<typeof canImportCharges>[0];
}

export interface ImportDefaults {
  providerId: string;
  locationId: string;
}

export interface ImportWarnings {
  /** Claims whose timely-filing deadline (rules engine, by the payer's regime) has passed. */
  pastDeadline: number;
  /** Claims whose deadline is within `FILING_WARNING_DAYS`. */
  dueSoon: number;
  /** Claims whose payer's regime has no filing rule configured. */
  notConfigured: number;
  /** Claims for a payer without an EDI payer ID or regime. */
  payerUnverified: number;
  /** Claims for a patient with no coverage (member ID) on file. */
  noCoverage: number;
  /** Claims for a patient inactive, merged, or gone at the source EHR. */
  patientInactive: number;
}

export function emptyWarnings(): ImportWarnings {
  return {
    pastDeadline: 0,
    dueSoon: 0,
    notConfigured: 0,
    payerUnverified: 0,
    noCoverage: 0,
    patientInactive: 0,
  };
}

/**
 * Adds one created claim to the warning counts. Timely filing is C1's `filingStatus` (rules engine, by
 * the payer's regime), as of `today`; it only warns, and never blocks the import (R-3.1.5).
 */
export function tallyWarnings(
  warnings: ImportWarnings,
  claim: {
    regime: Regime | null;
    serviceDate: string;
    today: string;
    payerVerified: boolean;
    noCoverage: boolean;
    patientInactive: boolean;
  },
): void {
  const filing = filingStatus(claim.regime, claim.serviceDate, claim.today);
  if (filing.state === "past_deadline") warnings.pastDeadline++;
  if (filing.state === "due_soon") warnings.dueSoon++;
  if (filing.state === "not_configured") warnings.notConfigured++;
  if (!claim.payerVerified) warnings.payerUnverified++;
  if (claim.noCoverage) warnings.noCoverage++;
  if (claim.patientInactive) warnings.patientInactive++;
}

export type ChargeImportResult =
  | {
      ok: true;
      batchId: string;
      claims: number;
      lines: number;
      billedCents: number;
      warnings: ImportWarnings;
    }
  | {
      ok: false;
      reason: "forbidden" | "defaults" | "validation" | "duplicate";
      problems: ChargeProblem[];
      total: number;
    };

/** Rows fetched per query, so an IN list stays far below PostgreSQL's parameter limit. */
const CHUNK = 1_000;

function chunks<T>(items: readonly T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type PayerMatch =
  { status: "matched"; payer: PayerOption } | { status: "not_found" } | { status: "ambiguous" };

/**
 * Matches the file's payer text to the practice's catalog with the same rule as the patient form
 * (`resolvePayerByName`: trimmed, case-insensitive, the verified payer wins a name tie). Two payers
 * that are still tied after that (same name and same verification state) can't be told apart, so
 * the row is refused rather than one picked. A blank text is never self-pay here.
 */
export function matchPayer(options: PayerOption[], text: string): PayerMatch {
  const resolution = resolvePayerByName(options, text);
  if (resolution.status !== "matched") return { status: "not_found" };
  const key = text.trim().toLowerCase();
  const tied = options.filter(
    (p) => p.name.trim().toLowerCase() === key && p.verified === resolution.payer.verified,
  );
  return tied.length > 1 ? { status: "ambiguous" } : { status: "matched", payer: resolution.payer };
}

/**
 * The service keys of a claim's lines for duplicate comparison: procedure code plus modifiers. Modifiers
 * are compared sorted so the same modifiers in another order still match; only the comparison sorts,
 * nothing stored is reordered.
 */
export function serviceKeys(lines: { procedureCode: string; modifiers: string[] }[]): Set<string> {
  return new Set(lines.map((l) => lineServiceKey(l.procedureCode, l.modifiers)));
}

export interface ServiceIdentity {
  patientId: string;
  payerId: string;
  serviceDate: string;
  keys: Set<string>;
}

/** Same patient, payer, and date of service, and at least one procedure-and-modifiers pair in common. */
export function isSameService(a: ServiceIdentity, b: ServiceIdentity): boolean {
  if (a.patientId !== b.patientId || a.payerId !== b.payerId || a.serviceDate !== b.serviceDate) return false;
  for (const key of a.keys) if (b.keys.has(key)) return true;
  return false;
}

interface Resolved {
  claim: ChargeClaim;
  patientId: string;
  payerId: string;
  providerId: string;
  locationId: string;
}

export async function importChargeClaims(
  tx: TenantTx,
  actor: ImportActor,
  parsed: { rowCount: number; claims: readonly ChargeClaim[] },
  defaults: ImportDefaults,
  today: string,
  /** Names this import in the audit log (the action also uses it for a refused attempt). */
  batchId: string = randomUUID(),
): Promise<ChargeImportResult> {
  const refused = (
    reason: "forbidden" | "defaults" | "validation" | "duplicate",
    problems: ChargeProblem[] = [],
    total = problems.length,
  ): ChargeImportResult => ({ ok: false, reason, problems, total });
  if (!canImportCharges(actor.role)) return refused("forbidden");
  if (parsed.claims.length === 0) return refused("validation");

  // One import per practice at a time, so the duplicate checks below hold until this commits. The lock is
  // advisory and per practice: it doesn't touch claim rows, so it can't deadlock with `correctClaim`, which
  // locks one existing claim row (`FOR UPDATE`) and never takes this lock; an import only inserts new claims.
  // Rate-limited per practice (`import_charges`) so a held lock can't be used to stall imports.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`claim_import:${actor.tenantId}`}))`);

  // Practice reference data (RLS limits every read to this practice; FKs bypass RLS, so the form's
  // default IDs are checked against what this tenant can see).
  const providerRows = await tx.select({ id: providers.id, npi: providers.npi }).from(providers);
  const locationRows = await tx.select({ id: locations.id, name: locations.name }).from(locations);
  if (
    !providerRows.some((p) => p.id === defaults.providerId) ||
    !locationRows.some((l) => l.id === defaults.locationId)
  ) {
    return refused("defaults");
  }
  const payerRows = await tx
    .select({ id: payers.id, name: payers.name, ediPayerId: payers.ediPayerId, regime: payers.regime })
    .from(payers);
  const payerOptions: PayerOption[] = payerRows.map((p) => ({
    id: p.id,
    name: p.name,
    verified: isPayerVerified(p),
  }));
  const payerById = new Map(payerRows.map((p) => [p.id, p]));

  // Re-upload of a file already imported: every claim number is already a claim.
  const existingNumbers = new Set<string>();
  for (const part of chunks(parsed.claims.map((c) => c.claimNumber))) {
    const rows = await tx
      .select({ claimNumber: claims.claimNumber })
      .from(claims)
      .where(inArray(claims.claimNumber, part));
    for (const row of rows) existingNumbers.add(row.claimNumber);
  }
  if (parsed.claims.every((c) => existingNumbers.has(c.claimNumber))) {
    return refused("duplicate", [{ row: 1, code: "already_imported" }]);
  }

  // Patients are matched by MRN and only read.
  const patientByMrn = new Map<string, { id: string; noCoverage: boolean; sourceInactive: boolean }>();
  for (const part of chunks([...new Set(parsed.claims.map((c) => c.mrn))])) {
    const rows = await tx
      .select({
        id: patients.id,
        mrn: patients.mrn,
        noCoverage: sql<boolean>`${patients.memberIdEnc} is null`,
        sourceStatus: patients.sourceStatus,
      })
      .from(patients)
      .where(inArray(patients.mrn, part));
    for (const row of rows) {
      patientByMrn.set(row.mrn, {
        id: row.id,
        noCoverage: row.noCoverage,
        sourceInactive: row.sourceStatus !== null,
      });
    }
  }

  const providerByNpi = new Map(providerRows.map((p) => [p.npi, p.id]));
  const locationsByName = new Map<string, string[]>();
  for (const l of locationRows) {
    const key = l.name.trim().toLowerCase();
    locationsByName.set(key, [...(locationsByName.get(key) ?? []), l.id]);
  }

  const problems: ChargeProblem[] = [];
  let total = 0;
  let nonDuplicate = false;
  const add = (claim: ChargeClaim, code: ChargeProblemCode, column?: ChargeColumnKey) => {
    total++;
    if (!DUPLICATE_CODES.includes(code)) nonDuplicate = true;
    if (problems.length < MAX_REPORT_PROBLEMS) {
      problems.push({ row: claim.firstRow, code, ...(column ? { column: columnLabel(column) } : {}) });
    }
  };

  const resolved: Resolved[] = [];
  for (const claim of parsed.claims) {
    const patient = patientByMrn.get(claim.mrn);
    if (!patient) add(claim, "patient_not_found", "mrn");
    const payer = matchPayer(payerOptions, claim.payerText);
    if (payer.status === "not_found") add(claim, "payer_not_found", "payer");
    if (payer.status === "ambiguous") add(claim, "payer_ambiguous", "payer");

    let providerId = defaults.providerId;
    if (claim.providerNpi) {
      const found = providerByNpi.get(claim.providerNpi);
      if (found) providerId = found;
      else add(claim, "provider_not_found", "providerNpi");
    }
    let locationId = defaults.locationId;
    if (claim.location) {
      const found = locationsByName.get(claim.location.toLowerCase()) ?? [];
      if (found.length === 1) locationId = found[0]!;
      else add(claim, found.length === 0 ? "location_not_found" : "location_ambiguous", "location");
    }
    if (existingNumbers.has(claim.claimNumber)) add(claim, "claim_number_exists", "claimNumber");

    if (patient && payer.status === "matched") {
      resolved.push({ claim, patientId: patient.id, payerId: payer.payer.id, providerId, locationId });
    }
  }

  // A row that matches an existing claim (any status) or another claim in this file.
  if (resolved.length > 0) {
    const patientIds = [...new Set(resolved.map((r) => r.patientId))];
    // Only the file's own dates of service, not the whole range between them.
    const dates = [...new Set(resolved.map((r) => r.claim.serviceDate))];
    const existingByPatient = new Map<string, Map<string, ServiceIdentity>>();
    for (const part of chunks(patientIds)) {
      const rows = await tx
        .select({
          claimId: claims.id,
          patientId: claims.patientId,
          payerId: claims.payerId,
          serviceDate: claims.serviceDate,
          procedureCode: claimLines.procedureCode,
          modifiers: claimLines.modifiers,
        })
        .from(claims)
        .innerJoin(claimLines, eq(claimLines.claimId, claims.id))
        .where(and(inArray(claims.patientId, part), inArray(claims.serviceDate, dates)));
      for (const row of rows) {
        const byClaim = existingByPatient.get(row.patientId) ?? new Map<string, ServiceIdentity>();
        const identity = byClaim.get(row.claimId) ?? {
          patientId: row.patientId,
          payerId: row.payerId,
          serviceDate: row.serviceDate,
          keys: new Set<string>(),
        };
        for (const key of serviceKeys([row])) identity.keys.add(key);
        byClaim.set(row.claimId, identity);
        existingByPatient.set(row.patientId, byClaim);
      }
    }
    // Bucketed by patient, payer, and date, so a 5,000-claim file compares within a bucket, not against every claim.
    const seenInFile = new Map<string, ServiceIdentity[]>();
    for (const r of resolved) {
      const identity: ServiceIdentity = {
        patientId: r.patientId,
        payerId: r.payerId,
        serviceDate: r.claim.serviceDate,
        keys: serviceKeys(r.claim.lines),
      };
      // A claim that already exists by number is reported once as such, not again as a match.
      if (!existingNumbers.has(r.claim.claimNumber)) {
        const others = [...(existingByPatient.get(r.patientId)?.values() ?? [])];
        if (others.some((other) => isSameService(identity, other))) add(r.claim, "matches_existing_claim");
      }
      const bucket = `${r.patientId}|${r.payerId}|${r.claim.serviceDate}`;
      const earlier = seenInFile.get(bucket);
      if (earlier) {
        if (earlier.some((other) => isSameService(identity, other))) add(r.claim, "matches_claim_in_file");
        earlier.push(identity);
      } else seenInFile.set(bucket, [identity]);
    }
  }

  if (total > 0) {
    return refused(nonDuplicate ? "validation" : "duplicate", problems, total);
  }

  // Everything matched: create the drafts, then audit, all in the caller's transaction.
  const drafts: DraftClaimInput[] = resolved.map((r) => ({
    claimNumber: r.claim.claimNumber,
    patientId: r.patientId,
    providerId: r.providerId,
    locationId: r.locationId,
    payerId: r.payerId,
    serviceDate: r.claim.serviceDate,
    diagnosisCodes: r.claim.diagnosisCodes,
    lines: r.claim.lines.map((l) => ({
      procedureCode: l.procedureCode,
      modifiers: l.modifiers,
      units: l.units,
      chargeCents: l.chargeCents,
    })),
  }));
  // Writes the claims, lines, and version 1, and audits `claim.created` once per claim (batch ID, counts).
  const created = await createDraftClaims(tx, actor, drafts, { reason: CHARGE_IMPORT_REASON, batchId });

  const warnings = emptyWarnings();
  for (const r of resolved) {
    const payer = payerById.get(r.payerId)!;
    const patient = patientByMrn.get(r.claim.mrn)!;
    tallyWarnings(warnings, {
      regime: payer.regime as Regime | null,
      serviceDate: r.claim.serviceDate,
      today,
      payerVerified: isPayerVerified(payer),
      noCoverage: patient.noCoverage,
      patientInactive: patient.sourceInactive,
    });
  }

  const lineTotal = created.reduce((sum, c) => sum + c.lineCount, 0);
  const billedCents = drafts.reduce(
    (sum, d) => sum + d.lines.reduce((lineSum, l) => lineSum + l.chargeCents, 0),
    0,
  );
  // One event for the import; the per-claim events were written with the claims. IDs and counts only.
  await audit(tx, {
    action: "claim.import_completed",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "claim_import",
    entityId: batchId,
    reason: CHARGE_IMPORT_REASON,
    metadata: { rows: parsed.rowCount, claims: created.length, lines: lineTotal, ...warnings },
  });
  return { ok: true, batchId, claims: created.length, lines: lineTotal, billedCents, warnings };
}
