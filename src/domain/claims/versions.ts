import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { claimLines, claims, claimVersions, users } from "@/db/schema";
import type { MessageKey } from "@/i18n/messages/types";
import type { Params } from "@/i18n/translate";
import { audit, auditBatch } from "@/lib/audit";
import { changedFields, snapshotOf, type Correction } from "./correction";
import { isUnsubmitted } from "./status";
import { en } from "@/i18n/messages/en";
import { createTranslator } from "@/i18n/translate";

/** Carries a message key (claims namespace) instead of English text; the action translates it. */
const english = createTranslator(en.claims, "en");
function englishMessage(key: MessageKey<"claims">, params?: Params): string {
  return english(key, params);
}

export class ClaimCorrectionError extends Error {
  constructor(
    public readonly key: MessageKey<"claims">,
    public readonly params?: Params,
  ) {
    // The message is the English text, so logs and tests read it directly; server actions translate
    // `key`/`params` for the user instead of showing `message`.
    super(englishMessage(key, params));
    this.name = "ClaimCorrectionError";
  }
}

/**
 * Corrects a draft or rejected claim and records the new version first (R-3.10.3). A person makes
 * every code change here, with a reason (R-3.10.1). `expectedVersion` rejects edits made from a
 * stale page. The database trigger refuses the update if the version row is missing.
 */
export async function correctClaim(
  tx: TenantTx,
  input: {
    tenantId: string;
    userId: string;
    claimId: string;
    expectedVersion: number;
    today: string;
    correction: Correction;
  },
): Promise<{ version: number; changedFields: string[] }> {
  const [claim] = await tx.select().from(claims).where(eq(claims.id, input.claimId)).for("update").limit(1);
  if (!claim) throw new ClaimCorrectionError("correction.error.claimNotFound");
  if (!isUnsubmitted(claim.status)) {
    throw new ClaimCorrectionError("correction.error.notCorrectable");
  }
  if (claim.version !== input.expectedVersion) {
    throw new ClaimCorrectionError("correction.error.staleVersion");
  }
  const { correction } = input;
  if (correction.serviceDate > input.today) {
    throw new ClaimCorrectionError("correction.error.futureServiceDate");
  }

  const lines = await tx
    .select()
    .from(claimLines)
    .where(eq(claimLines.claimId, claim.id))
    .orderBy(asc(claimLines.lineNumber));
  const incoming = new Map(correction.lines.map((l) => [l.lineNumber, l]));
  if (
    incoming.size !== correction.lines.length ||
    incoming.size !== lines.length ||
    lines.some((l) => !incoming.has(l.lineNumber))
  ) {
    throw new ClaimCorrectionError("correction.error.linesChanged");
  }

  const before = snapshotOf(claim, lines);
  const billedCents = correction.lines.reduce((sum, l) => sum + l.chargeCents, 0);
  const after = snapshotOf(
    {
      serviceDate: correction.serviceDate,
      diagnosisCodes: correction.diagnosisCodes,
      billedCents,
      status: claim.status,
    },
    correction.lines,
  );
  const changes = changedFields(before, after);
  if (changes.length === 0) throw new ClaimCorrectionError("correction.error.noChanges");

  const version = claim.version + 1;
  const [row] = await tx
    .insert(claimVersions)
    .values({
      tenantId: input.tenantId,
      claimId: claim.id,
      version,
      snapshot: after,
      changedFields: changes,
      reason: correction.reason,
      changedBy: input.userId,
    })
    .returning({ id: claimVersions.id });
  await tx
    .update(claims)
    .set({
      serviceDate: after.serviceDate,
      diagnosisCodes: after.diagnosisCodes,
      billedCents,
      version,
      updatedAt: new Date(),
    })
    .where(eq(claims.id, claim.id));
  for (const line of lines) {
    const next = incoming.get(line.lineNumber)!;
    const same =
      line.procedureCode === next.procedureCode &&
      line.modifiers.join(",") === next.modifiers.join(",") &&
      line.units === next.units &&
      line.chargeCents === next.chargeCents;
    if (same) continue;
    await tx
      .update(claimLines)
      .set({
        procedureCode: next.procedureCode,
        modifiers: next.modifiers,
        units: next.units,
        chargeCents: next.chargeCents,
      })
      .where(and(eq(claimLines.id, line.id), eq(claimLines.claimId, claim.id)));
  }

  await audit(tx, {
    action: "claim.corrected",
    actorUserId: input.userId,
    tenantId: input.tenantId,
    entityType: "claim",
    entityId: claim.id,
    // The typed reason can hold PHI: it stays in claim_versions (Restricted PHI). The audit row
    // points at that version and names the changed fields only; no codes, dates, or amounts.
    reason: "claim_correction",
    metadata: { version, versionId: row!.id, changedFields: changes.join(",") },
  });
  return { version, changedFields: changes };
}

export async function claimHistory(tx: TenantTx, claimId: string) {
  return tx
    .select({
      id: claimVersions.id,
      version: claimVersions.version,
      snapshot: claimVersions.snapshot,
      changedFields: claimVersions.changedFields,
      reason: claimVersions.reason,
      createdAt: claimVersions.createdAt,
      author: users.displayName,
      changedBy: claimVersions.changedBy,
    })
    .from(claimVersions)
    .leftJoin(users, eq(users.id, claimVersions.changedBy))
    .where(eq(claimVersions.claimId, claimId))
    .orderBy(desc(claimVersions.version));
}

/** The fixed reason recorded on version 1 of a claim created by the CSV charge import (localized when shown). */
export const CHARGE_IMPORT_REASON = "charge_import";

export interface DraftClaimInput {
  claimNumber: string;
  patientId: string;
  providerId: string;
  locationId: string;
  payerId: string;
  serviceDate: string;
  /** Exactly as the person's file gave them; nothing here adds, changes, or reorders a code (R-3.10.1). */
  diagnosisCodes: string[];
  lines: { procedureCode: string; modifiers: string[]; units: number; chargeCents: number }[];
}

/** Keeps each INSERT well under PostgreSQL's parameter limit. */
const INSERT_CHUNK = 500;

/**
 * Creates draft claims with their lines and version 1 of their history (R-3.10.3), in the caller's
 * transaction: the claim row, then its lines, then the snapshot, so the C1 triggers accept them (a
 * claim created in this transaction needs no earlier version). `billed_cents` is the exact sum of the
 * lines' integer cents.
 *
 * Contract: the caller supplies the version-1 `reason` (there is no default: a version always says why
 * it exists) and, optionally, a `batchId` that ties the claims to the operation that created them. This
 * function audits `claim.created` once per claim (IDs and counts only: batch ID, line count, version 1),
 * so no caller can create a claim without its PHI-write event; the caller audits the surrounding
 * operation (for the charge import, `claim.import_completed`). Nothing in the database forces a
 * version-1 row when a claim is inserted (the C1 triggers guard updates), so this function is the only
 * supported way to create a claim: see docs/PROJECT_STATE.md follow-ups.
 */
export async function createDraftClaims(
  tx: TenantTx,
  actor: { tenantId: string; userId: string },
  drafts: readonly DraftClaimInput[],
  options: { reason: string; batchId?: string },
): Promise<{ id: string; claimNumber: string; lineCount: number }[]> {
  const created = drafts.map((draft) => {
    const cents = draft.lines.map((l) => l.chargeCents);
    if (draft.lines.length === 0 || !cents.every((c) => Number.isSafeInteger(c) && c > 0)) {
      throw new Error("A draft claim needs at least one line, with whole-cent charges above zero.");
    }
    return { id: randomUUID(), draft, billedCents: cents.reduce((sum, c) => sum + c, 0) };
  });

  for (let i = 0; i < created.length; i += INSERT_CHUNK) {
    await tx.insert(claims).values(
      created.slice(i, i + INSERT_CHUNK).map(({ id, draft, billedCents }) => ({
        id,
        tenantId: actor.tenantId,
        claimNumber: draft.claimNumber,
        patientId: draft.patientId,
        providerId: draft.providerId,
        locationId: draft.locationId,
        payerId: draft.payerId,
        serviceDate: draft.serviceDate,
        diagnosisCodes: [...draft.diagnosisCodes],
        billedCents,
        paidCents: 0,
        status: "draft" as const,
        electronic: true,
        version: 1,
      })),
    );
  }
  const lineRows = created.flatMap(({ id, draft }) =>
    draft.lines.map((line, i) => ({
      tenantId: actor.tenantId,
      claimId: id,
      lineNumber: i + 1,
      procedureCode: line.procedureCode,
      modifiers: [...line.modifiers],
      units: line.units,
      chargeCents: line.chargeCents,
    })),
  );
  for (let i = 0; i < lineRows.length; i += INSERT_CHUNK) {
    await tx.insert(claimLines).values(lineRows.slice(i, i + INSERT_CHUNK));
  }
  for (let i = 0; i < created.length; i += INSERT_CHUNK) {
    await tx.insert(claimVersions).values(
      created.slice(i, i + INSERT_CHUNK).map(({ id, draft, billedCents }) => ({
        tenantId: actor.tenantId,
        claimId: id,
        version: 1,
        snapshot: snapshotOf(
          {
            serviceDate: draft.serviceDate,
            diagnosisCodes: draft.diagnosisCodes,
            billedCents,
            status: "draft",
            paidCents: 0,
          },
          draft.lines.map((line, n) => ({ lineNumber: n + 1, ...line })),
        ),
        changedFields: [],
        reason: options.reason,
        changedBy: actor.userId,
      })),
    );
  }
  for (let i = 0; i < created.length; i += INSERT_CHUNK) {
    await auditBatch(
      tx,
      created.slice(i, i + INSERT_CHUNK).map(({ id, draft }) => ({
        action: "claim.created" as const,
        actorUserId: actor.userId,
        tenantId: actor.tenantId,
        entityType: "claim" as const,
        entityId: id,
        reason: options.reason,
        metadata: {
          ...(options.batchId ? { batchId: options.batchId } : {}),
          lines: draft.lines.length,
          version: 1,
        },
      })),
    );
  }
  return created.map(({ id, draft }) => ({
    id,
    claimNumber: draft.claimNumber,
    lineCount: draft.lines.length,
  }));
}
