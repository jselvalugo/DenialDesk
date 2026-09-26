import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { addCalendarDays, todayIn } from "@rules/calendar";
import type { OperatorContext } from "@/auth/operator";
import { systemDb } from "@/db/client";
import { tenantAgreements, tenants, type AgreementStatus as AgreementRecordStatus } from "@/db/schema";
import { sanitizeDatabaseError } from "@/db/tenant";
import { audit, auditSystem } from "@/lib/audit";
import { PracticeError } from "./errors";

// Business Associate Agreements per practice (docs/specs/practice-agreements.md). Platform
// records handled only by the operator as the connection owner: the app role has no privileges on
// the table. Confidential contract documents, never PHI; file contents are never logged.

/** Upload cap; the server-action body limit in next.config.ts allows a little more than this. */
export const MAX_AGREEMENT_BYTES = 5 * 1024 * 1024;

/** Longest stored file name; longer names are rejected, not truncated, so the record stays exact. */
export const MAX_FILENAME_LENGTH = 255;

/** Operational reminder window for renewals, not a statutory value (spec: 60 days). */
export const EXPIRING_SOON_DAYS = 60;

/** Synthetic-only environments (ADR 0003) accept only files whose name carries this prefix. */
export const SYNTHETIC_FILE_PREFIX = "SYN-";

/** Shortest acceptable reason for marking an agreement as recorded in error. */
export const MIN_VOID_REASON_LENGTH = 5;

export type AgreementStatus = "missing" | "not_yet_effective" | "active" | "expiring" | "expired";

export interface AgreementDates {
  status: AgreementRecordStatus;
  effectiveDate: string;
  expiresOn: string | null;
}

const covers = (a: AgreementDates, day: string) =>
  a.status !== "voided" && a.effectiveDate <= day && (a.expiresOn === null || day <= a.expiresOn);

/**
 * A practice's BAA status on `today` (YYYY-MM-DD) from every agreement on file. A renewal recorded
 * ahead of its start supersedes the current agreement at once, so coverage is judged by whichever
 * agreement covers today: the active one, or its superseded (or historical) predecessor until the
 * renewal starts. Agreements recorded in error don't count. "Expiring" means the coverage ends
 * within EXPIRING_SOON_DAYS with no renewal on file that takes over without a gap.
 */
export function agreementStatus(agreements: readonly AgreementDates[], today: string): AgreementStatus {
  const active = agreements.find((a) => a.status === "active");
  if (!active) return "missing";
  const current = covers(active, today) ? active : agreements.find((a) => covers(a, today));
  if (!current) return today < active.effectiveDate ? "not_yet_effective" : "expired";
  if (current.expiresOn === null) return "active";
  const successor = current === active ? null : active;
  const renewedWithoutGap =
    successor !== null && successor.effectiveDate <= addCalendarDays(current.expiresOn, 1);
  if (renewedWithoutGap) return "active";
  return addCalendarDays(today, EXPIRING_SOON_DAYS) >= current.expiresOn ? "expiring" : "active";
}

export type FileCheck = { ok: true } | { ok: false; error: string };

/**
 * A PDF by content (not just its name), non-empty, within the size cap, with a storable name. In
 * synthetic-only environments (ADR 0003) the name must carry the synthetic prefix and the operator
 * must attest that the file is synthetic.
 */
export function checkAgreementFile(file: {
  name: string;
  size: number;
  head: Uint8Array;
  syntheticOnly: boolean;
  attestedSynthetic: boolean;
}): FileCheck {
  if (file.size === 0) return { ok: false, error: "Choose the signed agreement as a PDF file." };
  if (file.size > MAX_AGREEMENT_BYTES) {
    return { ok: false, error: "The file is larger than 5 MB. Export the signed PDF at a lower resolution." };
  }
  if (file.name.length > MAX_FILENAME_LENGTH || /[\u0000-\u001f\u007f]/.test(file.name)) {
    return { ok: false, error: "The file name is too long or contains unusual characters. Rename the file." };
  }
  const magic = Buffer.from(file.head.subarray(0, 5)).toString("latin1");
  if (magic !== "%PDF-" || !/\.pdf$/i.test(file.name)) {
    return { ok: false, error: "The file isn't a PDF. Upload the signed agreement as a PDF." };
  }
  if (file.syntheticOnly) {
    if (!file.name.toUpperCase().startsWith(SYNTHETIC_FILE_PREFIX)) {
      return {
        ok: false,
        error: `This environment holds synthetic practices only. Name test files ${SYNTHETIC_FILE_PREFIX}… and never upload a real agreement here.`,
      };
    }
    if (!file.attestedSynthetic)
      return { ok: false, error: "Confirm that the file is a synthetic test document." };
  }
  return { ok: true };
}

export interface AgreementInput {
  tenantId: string;
  effectiveDate: string;
  expiresOn: string | null;
  signedOn: string;
  practiceSigner: string;
  ourSigner: string;
  note: string | null;
  filename: string;
  content: Buffer;
  /** Operator's attestation, required only where syntheticDataOnly() (ADR 0003). */
  attestedSynthetic: boolean;
}

export interface AgreementRow extends AgreementDates {
  id: string;
  signedOn: string;
  practiceSigner: string;
  ourSigner: string;
  note: string | null;
  filename: string;
  sizeBytes: number;
  sha256: string;
  supersededById: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
}

const listColumns = {
  id: tenantAgreements.id,
  status: tenantAgreements.status,
  effectiveDate: tenantAgreements.effectiveDate,
  expiresOn: tenantAgreements.expiresOn,
  signedOn: tenantAgreements.signedOn,
  practiceSigner: tenantAgreements.practiceSigner,
  ourSigner: tenantAgreements.ourSigner,
  note: tenantAgreements.note,
  filename: tenantAgreements.filename,
  sizeBytes: tenantAgreements.sizeBytes,
  sha256: tenantAgreements.sha256,
  supersededById: tenantAgreements.supersededById,
  voidedAt: tenantAgreements.voidedAt,
  voidReason: tenantAgreements.voidReason,
  createdAt: tenantAgreements.createdAt,
};

export type RecordOutcome = "active" | "historical";

/**
 * Records a signed BAA for a customer practice. Normally it becomes the active agreement and the
 * previous active one, if any, becomes superseded and points at it; both stay on file. An
 * agreement that starts before the current active one is a back-fill: it is kept for the record
 * as "historical" and the current agreement is untouched. The audit event commits with the record.
 */
export async function recordAgreement(
  input: AgreementInput,
  operator: OperatorContext,
  options: { syntheticOnly: boolean },
): Promise<{ agreementId: string; supersededId: string | null; outcome: RecordOutcome }> {
  const check = checkAgreementFile({
    name: input.filename,
    size: input.content.length,
    head: input.content,
    syntheticOnly: options.syntheticOnly,
    attestedSynthetic: input.attestedSynthetic,
  });
  if (!check.ok) throw new PracticeError(check.error);
  const today = todayIn();
  if (input.expiresOn !== null && input.expiresOn < input.effectiveDate) {
    throw new PracticeError("The expiration date can't be before the effective date.");
  }
  if (input.signedOn > today) throw new PracticeError("The signed date can't be in the future.");

  const agreementId = randomUUID();
  const sha256 = createHash("sha256").update(input.content).digest("hex");
  try {
    const [tenant] = await systemDb()
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.id, input.tenantId), eq(tenants.kind, "customer")))
      .limit(1);
    if (!tenant) throw new PracticeError("That practice no longer exists or isn't a customer practice.");

    return await systemDb().transaction(async (tx) => {
      const activeFilter = and(
        eq(tenantAgreements.tenantId, input.tenantId),
        eq(tenantAgreements.kind, "baa"),
        eq(tenantAgreements.status, "active"),
      );
      const [current] = await tx
        .select({ id: tenantAgreements.id, effectiveDate: tenantAgreements.effectiveDate })
        .from(tenantAgreements)
        .where(activeFilter)
        .for("update");
      const outcome: RecordOutcome =
        current && current.effectiveDate > input.effectiveDate ? "historical" : "active";
      let supersededId: string | null = null;
      if (outcome === "active" && current) {
        await tx
          .update(tenantAgreements)
          .set({ status: "superseded", supersededById: agreementId })
          .where(eq(tenantAgreements.id, current.id));
        supersededId = current.id;
      }
      await tx.insert(tenantAgreements).values({
        id: agreementId,
        tenantId: input.tenantId,
        kind: "baa",
        status: outcome,
        effectiveDate: input.effectiveDate,
        expiresOn: input.expiresOn,
        signedOn: input.signedOn,
        practiceSigner: input.practiceSigner,
        ourSigner: input.ourSigner,
        note: input.note,
        filename: input.filename,
        contentType: "application/pdf",
        sizeBytes: input.content.length,
        sha256,
        content: input.content,
        recordedBy: operator.userId,
      });
      await audit(tx, {
        action: "operator.agreement_recorded",
        actorUserId: operator.userId,
        tenantId: input.tenantId,
        entityType: "tenant_agreement",
        entityId: agreementId,
        metadata: { outcome, supersededId, sizeBytes: input.content.length },
      });
      return { agreementId, supersededId, outcome };
    });
  } catch (error) {
    // Two recordings racing for the same practice: the loser hits the one-active index.
    if ((error as { cause?: { code?: string } })?.cause?.code === "23505") {
      throw new PracticeError(
        "Another agreement was just recorded for this practice. Reload the page to see it.",
      );
    }
    // Never rethrow raw: Drizzle's message would carry the query parameters (the PDF, signer names).
    throw sanitizeDatabaseError(error);
  }
}

/**
 * Marks an agreement as recorded in error. It stays on file and downloadable (retention) but no
 * longer counts: voiding the active agreement leaves the practice without one until the correct
 * agreement is recorded. The reason goes into the record and the audit event.
 */
export async function voidAgreement(
  input: { tenantId: string; agreementId: string; reason: string },
  operator: OperatorContext,
): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < MIN_VOID_REASON_LENGTH) {
    throw new PracticeError("Say why the agreement was recorded in error (at least a few words).");
  }
  try {
    await systemDb().transaction(async (tx) => {
      const updated = await tx
        .update(tenantAgreements)
        .set({ status: "voided", voidedAt: new Date(), voidedBy: operator.userId, voidReason: reason })
        .where(
          and(
            eq(tenantAgreements.id, input.agreementId),
            eq(tenantAgreements.tenantId, input.tenantId),
            ne(tenantAgreements.status, "voided"),
          ),
        )
        .returning({ id: tenantAgreements.id });
      if (updated.length === 0) {
        throw new PracticeError(
          "That agreement isn't on file for this practice, or is already marked as recorded in error.",
        );
      }
      await audit(tx, {
        action: "operator.agreement_voided",
        actorUserId: operator.userId,
        tenantId: input.tenantId,
        entityType: "tenant_agreement",
        entityId: input.agreementId,
        reason,
      });
    });
  } catch (error) {
    throw sanitizeDatabaseError(error);
  }
}

/** Every agreement on file for a practice, newest first, without the file contents. */
export async function listAgreements(tenantId: string): Promise<AgreementRow[]> {
  try {
    return await systemDb()
      .select(listColumns)
      .from(tenantAgreements)
      .where(eq(tenantAgreements.tenantId, tenantId))
      .orderBy(desc(tenantAgreements.createdAt));
  } catch (error) {
    throw sanitizeDatabaseError(error);
  }
}

/** Agreement dates for every practice (for the practices list's status column). */
export async function agreementDatesByTenant(): Promise<Map<string, AgreementDates[]>> {
  const rows = await systemDb()
    .select({
      tenantId: tenantAgreements.tenantId,
      status: tenantAgreements.status,
      effectiveDate: tenantAgreements.effectiveDate,
      expiresOn: tenantAgreements.expiresOn,
    })
    .from(tenantAgreements)
    .where(eq(tenantAgreements.kind, "baa"))
    .orderBy(desc(tenantAgreements.createdAt));
  const byTenant = new Map<string, AgreementDates[]>();
  for (const { tenantId, ...dates } of rows) {
    const list = byTenant.get(tenantId) ?? [];
    list.push(dates);
    byTenant.set(tenantId, list);
  }
  return byTenant;
}

export interface AgreementFile {
  tenantId: string;
  filename: string;
  contentType: string;
  sha256: string;
  content: Buffer;
}

/** The signed copy for download, audited; null when the agreement isn't on file for that practice. */
export async function openAgreementFile(
  tenantId: string,
  agreementId: string,
  operator: OperatorContext,
): Promise<AgreementFile | null> {
  const [row] = await systemDb()
    .select({
      tenantId: tenantAgreements.tenantId,
      filename: tenantAgreements.filename,
      contentType: tenantAgreements.contentType,
      sha256: tenantAgreements.sha256,
      content: tenantAgreements.content,
    })
    .from(tenantAgreements)
    .where(and(eq(tenantAgreements.id, agreementId), eq(tenantAgreements.tenantId, tenantId)))
    .limit(1)
    .catch((error: unknown) => {
      throw sanitizeDatabaseError(error);
    });
  if (!row) return null;
  await auditSystem({
    action: "operator.agreement_downloaded",
    actorUserId: operator.userId,
    tenantId,
    entityType: "tenant_agreement",
    entityId: agreementId,
    metadata: { sizeBytes: row.content.length },
  });
  return { ...row, content: Buffer.from(row.content) };
}
