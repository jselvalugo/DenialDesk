import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { integrationPayerMappings, integrationSyncIssues, patients } from "@/db/schema";
import { isDatabaseError, type TenantTx } from "@/db/tenant";
import {
  beneficiaryId,
  selectPrimaryCoverage,
  type CoverageSelection,
} from "@/integrations/fhir/map-coverage";
import { mapPatient, type MappedPatient } from "@/integrations/fhir/map-patient";
import { coverageResourceSchema } from "@/integrations/fhir/types";
import { auditBatch, type AuditEvent } from "@/lib/audit";
import { log } from "@/lib/log";
import { INTEGRATION_SERVICE_PRINCIPAL_ID } from "./principal";
import { normalizeIssueCode, type SyncIssueCode, type SyncStoredCode } from "./sync-codes";

// One committed page of a sync (docs/specs/patient-integrations.md PI2b): maps each Patient entry,
// picks its primary Coverage, and upserts, links, or refuses the row, inside the page's transaction
// (`withTenantAsSystem`: the `denialdesk_app` role, so row-level security and the
// `patients_synced_readonly` trigger apply to every statement). It never writes `claims` or claim
// versions (spec: "Sync never writes claims"), never touches tags, custom fields or the phone, and
// never logs: PHI stays in memory and in the database; audit events and issue rows carry IDs and
// fixed codes only.

/** Issue rows kept per run; past it only the counts and one `issues_truncated` code are recorded. */
export const MAX_ISSUE_ROWS_PER_RUN = 1_000;

export interface PageContext {
  tenantId: string;
  runId: string;
  connectionId: string;
  /** The administrator who pressed Sync now (audit metadata), null for a scheduled run. */
  triggeredBy: string | null;
  mrnSystem: string;
  nineDigitsVerified: boolean;
  now: Date;
  /** The practice date (America/New_York), `YYYY-MM-DD`: what "today" means for periods and ages. */
  today: string;
  /** Field-level encryption of the member ID (R-7.3.3). */
  encrypt: (plaintext: string) => string;
  decrypt: (ciphertext: string) => string;
  /** "where": the runtime function id and host, in every audit event's metadata. */
  runtime: { function: string; host: string };
  /** Shared across a run's pages: how many issue rows may still be written. */
  issueRows: { remaining: number };
}

export interface PageOutcome {
  created: number;
  updated: number;
  linked: number;
  unchanged: number;
  /** Records skipped by a required rule or a conflict; each has an issue code. */
  skipped: number;
  /** Of `skipped`: MRN conflicts (the manual patient's ID is on the issue row). */
  conflicts: number;
  /** Distinct codes seen on this page (skips, notes, conflicts), all from the allow-list in `sync-codes.ts`. */
  codes: Set<SyncStoredCode>;
  /** Whether any patient row was written, which is what locks the connection's endpoint. */
  storedAny: boolean;
}

interface Issue {
  code: SyncIssueCode;
  patientId: string | null;
}

type Existing = typeof patients.$inferSelect;

/** The columns a sync writes, as `patients` column names (audit lists these names, never values). */
interface Desired {
  mrn: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  sex: "F" | "M" | "U";
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  primaryPayerId: string | null;
  coverageStatus: "none" | "mapped" | "unmapped" | "needs_review";
  coveragePayorKey: string | null;
  /** Null unless the coverage is usable; the plaintext never leaves this module. */
  memberId: string | null;
  sourceStatus: "inactive" | "merged" | null;
  sourceRestricted: boolean;
  sourceSensitivity: string[];
  /**
   * The source's `meta.versionId` / `meta.lastUpdated` stamps. They are recorded as the source states them and
   * can be stale or reset by the source (a restore, a vendor migration): they order two copies of a record
   * (`isOlderCopy`) and decide nothing else. A stamp that goes backwards is ignored, never "corrected".
   */
  sourceVersionId: string | null;
  sourceLastUpdated: Date | null;
}

const FIELD_COLUMNS: readonly (readonly [keyof Desired & keyof Existing, string])[] = [
  ["mrn", "mrn"],
  ["firstName", "first_name"],
  ["lastName", "last_name"],
  ["birthDate", "birth_date"],
  ["sex", "sex"],
  ["addressLine1", "address_line1"],
  ["city", "city"],
  ["state", "state"],
  ["postalCode", "postal_code"],
  ["primaryPayerId", "primary_payer_id"],
  ["coverageStatus", "coverage_status"],
  ["coveragePayorKey", "coverage_payor_key"],
  ["sourceStatus", "source_status"],
  ["sourceRestricted", "source_restricted"],
];

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** The raw coverage entries grouped by the patient they cover (`beneficiary`), parsed once. */
export function groupCoverages(raw: readonly unknown[]): Map<string, unknown[]> {
  const grouped = new Map<string, unknown[]>();
  for (const entry of raw) {
    const parsed = coverageResourceSchema.safeParse(entry);
    const patientId = parsed.success ? beneficiaryId(parsed.data) : null;
    if (patientId === null) continue;
    const list = grouped.get(patientId) ?? [];
    list.push(entry);
    grouped.set(patientId, list);
  }
  return grouped;
}

/**
 * The coverage-derived columns for a selection: `mapped` only when an administrator has mapped the
 * payor key to a payer (never guessed, CLAUDE.md non-negotiable 9); the member ID only for a usable
 * (`mapped` or `unmapped`) coverage, as the `patients_member_id_presence` CHECK requires.
 */
function coverageColumnsFor(selection: CoverageSelection, payerByKey: ReadonlyMap<string, string | null>) {
  const payerId = selection.payorKey ? (payerByKey.get(selection.payorKey) ?? null) : null;
  const coverageStatus: Desired["coverageStatus"] =
    selection.status === "unmapped" && payerId ? "mapped" : selection.status;
  const usable = coverageStatus === "mapped" || coverageStatus === "unmapped";
  return {
    primaryPayerId: coverageStatus === "mapped" ? payerId : null,
    coverageStatus,
    coveragePayorKey: usable ? selection.payorKey : null,
    memberId: usable ? selection.memberId : null,
  };
}

function desiredFor(
  mapped: MappedPatient,
  selection: CoverageSelection,
  payerByKey: ReadonlyMap<string, string | null>,
): Desired {
  return {
    mrn: mapped.mrn,
    firstName: mapped.firstName,
    lastName: mapped.lastName,
    birthDate: mapped.birthDate,
    sex: mapped.sex,
    addressLine1: mapped.addressLine1,
    city: mapped.city,
    state: mapped.state,
    postalCode: mapped.postalCode,
    ...coverageColumnsFor(selection, payerByKey),
    sourceStatus: mapped.sourceStatus,
    sourceRestricted: mapped.sourceRestricted,
    sourceSensitivity: mapped.sourceSensitivity,
    sourceVersionId: mapped.sourceVersionId,
    sourceLastUpdated: mapped.sourceLastUpdated,
  };
}

/** Names of the columns whose value differs, and whether the member ID differs (compared decrypted). */
function differences(existing: Existing, desired: Desired, ctx: PageContext): string[] {
  const changed: string[] = [];
  for (const [key, column] of FIELD_COLUMNS) {
    if (existing[key] !== desired[key]) changed.push(column);
  }
  if (!sameList(existing.sourceSensitivity, desired.sourceSensitivity)) changed.push("source_sensitivity");
  if (memberIdChanged(existing, desired.memberId, ctx)) changed.push("member_id");
  return changed;
}

function memberIdChanged(existing: Existing, memberId: string | null, ctx: PageContext): boolean {
  if (memberId === null) return existing.memberIdEnc !== null;
  if (existing.memberIdEnc === null) return true;
  try {
    return ctx.decrypt(existing.memberIdEnc) !== memberId;
  } catch {
    return true;
  }
}

function auditEvent(
  ctx: PageContext,
  action: AuditEvent["action"],
  patientId: string,
  changed?: string[],
): AuditEvent {
  return {
    action,
    system: true,
    actorUserId: INTEGRATION_SERVICE_PRINCIPAL_ID,
    tenantId: ctx.tenantId,
    entityType: "patient",
    entityId: patientId,
    reason: "ehr_sync",
    metadata: {
      connection_id: ctx.connectionId,
      run_id: ctx.runId,
      triggered_by: ctx.triggeredBy,
      runtime_function: ctx.runtime.function,
      runtime_host: ctx.runtime.host,
      ...(changed ? { changed_fields: changed.join(",") } : {}),
    },
  };
}

/**
 * Columns to write for `desired`: every synced column, with the member ID encrypted only when it
 * changed (a fresh ciphertext for an unchanged value would be a pointless write).
 */
function columnsFor(desired: Desired, existing: Existing | undefined, ctx: PageContext) {
  const { memberId, ...rest } = desired;
  const memberIdEnc =
    existing && !memberIdChanged(existing, memberId, ctx)
      ? existing.memberIdEnc
      : memberId === null
        ? null
        : ctx.encrypt(memberId);
  return {
    ...rest,
    memberIdEnc,
    memberIdLast4: memberId === null ? null : memberId.slice(-4),
    syncedAt: sql`now()`,
    updatedAt: sql`now()`,
  };
}

/** The payer mapping for every payor key of this connection: key -> payer id (null: seen, not mapped). */
async function loadPayerMappings(tx: TenantTx, ctx: PageContext): Promise<Map<string, string | null>> {
  const rows = await tx
    .select({ key: integrationPayerMappings.payorKey, payerId: integrationPayerMappings.payerId })
    .from(integrationPayerMappings)
    .where(
      and(
        eq(integrationPayerMappings.tenantId, ctx.tenantId),
        eq(integrationPayerMappings.connectionId, ctx.connectionId),
      ),
    );
  return new Map(rows.map((row) => [row.key, row.payerId]));
}

async function existingByExternalId(tx: TenantTx, ctx: PageContext, externalId: string) {
  const [row] = await tx
    .select()
    .from(patients)
    .where(
      and(
        eq(patients.tenantId, ctx.tenantId),
        eq(patients.sourceConnectionId, ctx.connectionId),
        eq(patients.externalId, externalId),
        eq(patients.source, "fhir"),
      ),
    );
  return row;
}

async function holderOfMrn(tx: TenantTx, ctx: PageContext, mrn: string) {
  const [row] = await tx
    .select()
    .from(patients)
    .where(and(eq(patients.tenantId, ctx.tenantId), eq(patients.mrn, mrn)));
  return row;
}

type Result =
  | {
      kind: "created" | "updated" | "linked" | "unchanged";
      patientId: string;
      changed: string[];
      wrote: boolean;
    }
  | { kind: "conflict"; holderId: string | null }
  | { kind: "rejected"; patientId: string | null };

/** The unique index on (tenant, mrn) was hit: an MRN conflict, not a failure of the run. */
function isMrnConflict(error: unknown): boolean {
  return isDatabaseError(error) && error.code === "23505" && error.constraint === "patients_tenant_mrn_key";
}

/**
 * A CHECK constraint refused the row (SQLSTATE 23514). The mapper already holds every value to the
 * database's limits, so this is a defense for a future mismatch between the two: one record is skipped
 * (`record_rejected`), the page still commits, and the watermark can't be wedged by a single record.
 * The warning names the constraint (a schema identifier) and the run, never a value.
 */
function rejectedByCheck(error: unknown, ctx: PageContext): boolean {
  if (!isDatabaseError(error) || error.code !== "23514") return false;
  log.warn("integration.record_rejected", { runId: ctx.runId, constraint: error.constraint ?? "unknown" });
  return true;
}

/**
 * Whether the incoming copy of a record is provably older than the stored one. `meta.lastUpdated` is
 * the primary stamp; a server that omits it (or a record stamped equal) falls back to `meta.versionId`,
 * compared only when both are all-digit strings (FHIR says a version id is opaque; a purely numeric one
 * is the common counter, and anything else can't be ordered, so it is not judged older). Both stamps are
 * only as trustworthy as the source server: a server that resets its version counter after a restore
 * looks "older" here until its `lastUpdated` moves forward, which is why `lastUpdated` wins when present
 * on both sides. Never guesses: an unordered pair is accepted, as before.
 */
export function isOlderCopy(
  existing: Pick<Existing, "sourceLastUpdated" | "sourceVersionId">,
  mapped: Pick<MappedPatient, "sourceLastUpdated" | "sourceVersionId">,
): boolean {
  if (existing.sourceLastUpdated && mapped.sourceLastUpdated) {
    const incoming = mapped.sourceLastUpdated.getTime();
    const stored = existing.sourceLastUpdated.getTime();
    if (incoming !== stored) return incoming < stored;
  }
  const incomingVersion = mapped.sourceVersionId;
  const storedVersion = existing.sourceVersionId;
  if (
    incomingVersion &&
    storedVersion &&
    /^\d{1,15}$/.test(incomingVersion) &&
    /^\d{1,15}$/.test(storedVersion)
  ) {
    return Number(incomingVersion) < Number(storedVersion);
  }
  return false;
}

async function upsertOne(
  tx: TenantTx,
  ctx: PageContext,
  mapped: MappedPatient,
  desired: Desired,
): Promise<Result> {
  const existing = await existingByExternalId(tx, ctx, mapped.externalId);
  if (existing) {
    // No regression (threat model T4): an older copy of a record never overwrites a newer one.
    if (isOlderCopy(existing, mapped)) {
      return { kind: "unchanged", patientId: existing.id, changed: [], wrote: false };
    }
    const changed = differences(existing, desired, ctx);
    if (changed.length === 0) return { kind: "unchanged", patientId: existing.id, changed, wrote: false };
    try {
      // A savepoint: a unique violation must not abort the page's transaction.
      await tx.transaction(async (savepoint) => {
        await savepoint
          .update(patients)
          .set(columnsFor(desired, existing, ctx))
          .where(and(eq(patients.tenantId, ctx.tenantId), eq(patients.id, existing.id)));
      });
    } catch (error) {
      if (rejectedByCheck(error, ctx)) return { kind: "rejected", patientId: existing.id };
      if (!isMrnConflict(error)) throw error;
      return { kind: "conflict", holderId: (await holderOfMrn(tx, ctx, desired.mrn))?.id ?? null };
    }
    return { kind: "updated", patientId: existing.id, changed, wrote: true };
  }

  const holder = await holderOfMrn(tx, ctx, desired.mrn);
  if (holder) {
    // Linking: MRN **and** birth date equal to a manual patient. Nothing else: no fuzzy matching.
    if (holder.source === "manual" && holder.birthDate === desired.birthDate) {
      const changed = differences(holder, desired, ctx);
      try {
        await tx.transaction(async (savepoint) => {
          await savepoint
            .update(patients)
            .set({
              ...columnsFor(desired, holder, ctx),
              source: "fhir",
              sourceConnectionId: ctx.connectionId,
              externalId: mapped.externalId,
            })
            .where(and(eq(patients.tenantId, ctx.tenantId), eq(patients.id, holder.id)));
        });
      } catch (error) {
        if (rejectedByCheck(error, ctx)) return { kind: "rejected", patientId: holder.id };
        throw error;
      }
      return { kind: "linked", patientId: holder.id, changed, wrote: true };
    }
    // MRN equal, birth date different (or the holder is another synced row): nothing merged.
    return { kind: "conflict", holderId: holder.id };
  }

  try {
    const inserted = await tx.transaction(async (savepoint) => {
      const [row] = await savepoint
        .insert(patients)
        .values({
          ...columnsFor(desired, undefined, ctx),
          tenantId: ctx.tenantId,
          source: "fhir",
          sourceConnectionId: ctx.connectionId,
          externalId: mapped.externalId,
        })
        .returning({ id: patients.id });
      return row!;
    });
    return { kind: "created", patientId: inserted.id, changed: [], wrote: true };
  } catch (error) {
    if (rejectedByCheck(error, ctx)) return { kind: "rejected", patientId: null };
    if (!isMrnConflict(error)) throw error;
    return { kind: "conflict", holderId: (await holderOfMrn(tx, ctx, desired.mrn))?.id ?? null };
  }
}

/**
 * Maps and stores one page. `rawPatients` are the raw `Patient` entries (already checked by the raw
 * `SYN` guard where that applies); `coverage` groups the raw Coverage entries by beneficiary. Refused
 * or conflicting records are skipped with a code and an issue row; nothing is guessed. Runs entirely
 * inside the caller's transaction, so an unexpected error rolls the page back.
 */
export async function commitPage(
  tx: TenantTx,
  ctx: PageContext,
  rawPatients: readonly unknown[],
  coverage: ReadonlyMap<string, unknown[]>,
): Promise<PageOutcome> {
  const outcome: PageOutcome = {
    created: 0,
    updated: 0,
    linked: 0,
    unchanged: 0,
    skipped: 0,
    conflicts: 0,
    codes: new Set(),
    storedAny: false,
  };
  const issues: Issue[] = [];
  const events: AuditEvent[] = [];
  const payerByKey = await loadPayerMappings(tx, ctx);
  const seenPayors = new Map<string, string | null>();

  for (const raw of rawPatients) {
    const mapped = mapPatient(raw, ctx);
    if (!mapped.ok) {
      outcome.skipped += 1;
      outcome.codes.add(mapped.code);
      // Tie the issue to the DenialDesk patient this record belongs to, if it already has one.
      const known = mapped.externalId ? await existingByExternalId(tx, ctx, mapped.externalId) : undefined;
      issues.push({ code: mapped.code, patientId: known?.id ?? null });
      continue;
    }
    const selection = selectPrimaryCoverage(
      coverage.get(mapped.patient.externalId) ?? [],
      mapped.patient.externalId,
      ctx.today,
    );
    const desired = desiredFor(mapped.patient, selection, payerByKey);
    if (selection.payorKey && selection.status === "unmapped") {
      seenPayors.set(selection.payorKey, selection.payorName);
    }

    const result = await upsertOne(tx, ctx, mapped.patient, desired);
    if (result.kind === "conflict") {
      outcome.skipped += 1;
      outcome.conflicts += 1;
      outcome.codes.add("mrn_conflict");
      issues.push({ code: "mrn_conflict", patientId: result.holderId });
      continue;
    }
    if (result.kind === "rejected") {
      outcome.skipped += 1;
      outcome.codes.add("record_rejected");
      issues.push({ code: "record_rejected", patientId: result.patientId });
      continue;
    }
    outcome[result.kind] += 1;
    if (result.wrote) outcome.storedAny = true;
    if (result.kind === "unchanged") continue;

    const action = {
      created: "patient.synced_created",
      updated: "patient.synced_updated",
      linked: "patient.linked_to_source",
    } as const;
    events.push(
      auditEvent(
        ctx,
        action[result.kind],
        result.patientId,
        result.kind === "created" ? undefined : result.changed,
      ),
    );
    if (result.kind !== "created" && result.changed.includes("source_status")) {
      if (desired.sourceStatus === "inactive")
        events.push(auditEvent(ctx, "patient.source_inactivated", result.patientId));
      if (desired.sourceStatus === "merged")
        events.push(auditEvent(ctx, "patient.source_merged", result.patientId));
    }
    if (result.kind === "linked") {
      // "One row per skipped or linked resource" (schema): the history links to the patient it joined.
      outcome.codes.add("linked_to_source");
      issues.push({ code: "linked_to_source", patientId: result.patientId });
    }
    // Non-fatal notes: stored, and recorded for the administrator (an incomplete address; a minor the
    // administrator may want to tag; the tag is never set automatically, spec "Field mapping").
    for (const note of mapped.notes) {
      if (note === "review_required" && result.kind === "updated") continue;
      outcome.codes.add(note);
      issues.push({ code: note, patientId: result.patientId });
    }
  }

  await recordPayors(tx, ctx, seenPayors, payerByKey);
  await recordIssues(tx, ctx, issues, outcome);
  await auditBatch(tx, events);
  return outcome;
}

/** Records each payor key seen with a usable coverage that has no mapping row yet, unmapped (payer null). */
async function recordPayors(
  tx: TenantTx,
  ctx: PageContext,
  seen: ReadonlyMap<string, string | null>,
  known: ReadonlyMap<string, string | null>,
): Promise<void> {
  const fresh = [...seen].filter(([key]) => !known.has(key));
  if (fresh.length === 0) return;
  await tx
    .insert(integrationPayerMappings)
    .values(
      fresh.map(([payorKey, payorName]) => ({
        tenantId: ctx.tenantId,
        connectionId: ctx.connectionId,
        payorKey,
        payorName,
        updatedBy: INTEGRATION_SERVICE_PRINCIPAL_ID,
      })),
    )
    .onConflictDoNothing({
      target: [
        integrationPayerMappings.tenantId,
        integrationPayerMappings.connectionId,
        integrationPayerMappings.payorKey,
      ],
    });
}

async function recordIssues(tx: TenantTx, ctx: PageContext, issues: readonly Issue[], outcome: PageOutcome) {
  if (issues.length === 0) return;
  const keep = issues.slice(0, Math.max(ctx.issueRows.remaining, 0));
  if (keep.length < issues.length) outcome.codes.add("issues_truncated");
  ctx.issueRows.remaining -= keep.length;
  if (keep.length === 0) return;
  await tx.insert(integrationSyncIssues).values(
    keep.map((issue) => ({
      tenantId: ctx.tenantId,
      runId: ctx.runId,
      // Through the allow-list once more at the last moment: nothing else is ever stored.
      code: normalizeIssueCode(issue.code),
      patientId: issue.patientId,
    })),
  );
}

// -- Re-deriving coverage when a payer mapping changes -----------------------------------------------

/** Patients re-derived per transaction. */
export const REDERIVE_BATCH = 100;

/**
 * Synced patients of this connection whose payer mapping (`integration_payer_mappings`, by the payor
 * key the patient's coverage came from) is **newer than the patient's `synced_at`**: a mapping the
 * administrator saved after the last time the patient's coverage was derived. The payer-mapping page
 * can't apply it itself (`patients_synced_readonly` only allows those writes inside a running sync
 * run), and the patient may not have changed at the EHR/PM at all (so `Patient?_lastUpdated` never
 * returns it, and its `versionId` is unchanged), so the sync looks for these patients explicitly and
 * re-derives their coverage. Ordered by id, at most `limit`; a patient leaves the set as soon as its
 * `synced_at` is refreshed.
 */
export async function findRederiveCandidates(
  tx: TenantTx,
  ctx: Pick<PageContext, "tenantId" | "connectionId">,
  limit: number = REDERIVE_BATCH,
): Promise<{ id: string; externalId: string }[]> {
  const rows = await tx
    .select({ id: patients.id, externalId: patients.externalId })
    .from(patients)
    .innerJoin(
      integrationPayerMappings,
      and(
        eq(integrationPayerMappings.tenantId, patients.tenantId),
        eq(integrationPayerMappings.connectionId, patients.sourceConnectionId),
        eq(integrationPayerMappings.payorKey, patients.coveragePayorKey),
      ),
    )
    .where(
      and(
        eq(patients.tenantId, ctx.tenantId),
        eq(patients.sourceConnectionId, ctx.connectionId),
        eq(patients.source, "fhir"),
        or(isNull(patients.syncedAt), lt(patients.syncedAt, integrationPayerMappings.updatedAt)),
      ),
    )
    .orderBy(patients.id)
    .limit(limit);
  return rows.flatMap((row) => (row.externalId === null ? [] : [{ id: row.id, externalId: row.externalId }]));
}

/**
 * Re-derives the coverage-derived columns (payer, coverage status, payor key, member ID) of these
 * patients from their freshly fetched Coverage and the current payer mappings, whatever the
 * Patient's `versionId` says. A patient whose derivation changed is updated and audited
 * (`patient.synced_updated`, the changed column names); one that didn't change only has `synced_at`
 * refreshed, so it leaves the candidate set (no audit event and no `updated_at` bump for that: no
 * patient data changed, and a bump would make an administrator's open tag edit look stale).
 */
export async function rederiveCoverage(
  tx: TenantTx,
  ctx: PageContext,
  ids: readonly string[],
  coverage: ReadonlyMap<string, unknown[]>,
): Promise<PageOutcome> {
  const outcome: PageOutcome = {
    created: 0,
    updated: 0,
    linked: 0,
    unchanged: 0,
    skipped: 0,
    conflicts: 0,
    codes: new Set(),
    storedAny: false,
  };
  if (ids.length === 0) return outcome;
  const rows = await tx
    .select()
    .from(patients)
    .where(
      and(
        eq(patients.tenantId, ctx.tenantId),
        eq(patients.sourceConnectionId, ctx.connectionId),
        eq(patients.source, "fhir"),
        inArray(patients.id, [...ids]),
      ),
    );
  const payerByKey = await loadPayerMappings(tx, ctx);
  const seenPayors = new Map<string, string | null>();
  const events: AuditEvent[] = [];

  for (const existing of rows) {
    if (existing.externalId === null) continue;
    const selection = selectPrimaryCoverage(
      coverage.get(existing.externalId) ?? [],
      existing.externalId,
      ctx.today,
    );
    if (selection.payorKey && selection.status === "unmapped")
      seenPayors.set(selection.payorKey, selection.payorName);
    const { memberId, ...columns } = coverageColumnsFor(selection, payerByKey);

    const changed: string[] = [];
    if (existing.primaryPayerId !== columns.primaryPayerId) changed.push("primary_payer_id");
    if (existing.coverageStatus !== columns.coverageStatus) changed.push("coverage_status");
    if (existing.coveragePayorKey !== columns.coveragePayorKey) changed.push("coverage_payor_key");
    if (memberIdChanged(existing, memberId, ctx)) changed.push("member_id");

    if (changed.length === 0) {
      await tx
        .update(patients)
        .set({ syncedAt: sql`now()` })
        .where(and(eq(patients.tenantId, ctx.tenantId), eq(patients.id, existing.id)));
      outcome.unchanged += 1;
      continue;
    }
    await tx
      .update(patients)
      .set({
        ...columns,
        memberIdEnc: changed.includes("member_id")
          ? memberId === null
            ? null
            : ctx.encrypt(memberId)
          : existing.memberIdEnc,
        memberIdLast4: memberId === null ? null : memberId.slice(-4),
        syncedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(patients.tenantId, ctx.tenantId), eq(patients.id, existing.id)));
    outcome.updated += 1;
    outcome.storedAny = true;
    events.push(auditEvent(ctx, "patient.synced_updated", existing.id, changed));
  }

  await recordPayors(tx, ctx, seenPayors, payerByKey);
  await auditBatch(tx, events);
  return outcome;
}
