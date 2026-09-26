import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { addCalendarDays, todayIn } from "@rules/calendar";
import type { OperatorContext } from "@/auth/operator";
import { systemDb } from "@/db/client";
import { tenantAgreements, tenants } from "@/db/schema";
import { auditSystem } from "@/lib/audit";
import { PracticeError } from "./errors";

// Business Associate Agreements per practice (docs/specs/practice-agreements.md). Platform
// records handled only by the operator as the connection owner: the app role has no privileges on
// the table. Confidential contract documents, never PHI; file contents are never logged.

/** Upload cap; the server-action body limit in next.config.ts allows a little more than this. */
export const MAX_AGREEMENT_BYTES = 5 * 1024 * 1024;

/** Operational reminder window for renewals, not a statutory value (spec: 60 days). */
export const EXPIRING_SOON_DAYS = 60;

export type AgreementStatus = "missing" | "not_yet_effective" | "active" | "expiring" | "expired";

export interface ActiveAgreementDates {
  effectiveDate: string;
  expiresOn: string | null;
}

/** Status of a practice's active agreement on `today` (YYYY-MM-DD); "missing" without one. */
export function agreementStatus(
  active: ActiveAgreementDates | null | undefined,
  today: string,
): AgreementStatus {
  if (!active) return "missing";
  if (today < active.effectiveDate) return "not_yet_effective";
  if (active.expiresOn === null) return "active";
  if (today > active.expiresOn) return "expired";
  if (addCalendarDays(today, EXPIRING_SOON_DAYS) >= active.expiresOn) return "expiring";
  return "active";
}

export type FileCheck = { ok: true } | { ok: false; error: string };

/** A PDF by content (not just its name), non-empty, and within the size cap. */
export function checkAgreementFile(file: { name: string; size: number; head: Uint8Array }): FileCheck {
  if (file.size === 0) return { ok: false, error: "Choose the signed agreement as a PDF file." };
  if (file.size > MAX_AGREEMENT_BYTES) {
    return { ok: false, error: "The file is larger than 5 MB. Export the signed PDF at a lower resolution." };
  }
  const magic = Buffer.from(file.head.subarray(0, 5)).toString("latin1");
  if (magic !== "%PDF-" || !/\.pdf$/i.test(file.name)) {
    return { ok: false, error: "The file isn't a PDF. Upload the signed agreement as a PDF." };
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
  templateVersion: string;
  note: string | null;
  filename: string;
  content: Buffer;
}

export interface AgreementRow {
  id: string;
  status: "active" | "superseded";
  effectiveDate: string;
  expiresOn: string | null;
  signedOn: string;
  practiceSigner: string;
  ourSigner: string;
  templateVersion: string;
  note: string | null;
  filename: string;
  sizeBytes: number;
  sha256: string;
  supersededById: string | null;
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
  templateVersion: tenantAgreements.templateVersion,
  note: tenantAgreements.note,
  filename: tenantAgreements.filename,
  sizeBytes: tenantAgreements.sizeBytes,
  sha256: tenantAgreements.sha256,
  supersededById: tenantAgreements.supersededById,
  createdAt: tenantAgreements.createdAt,
};

/**
 * Records a signed BAA for a customer practice. The previous active agreement, if any, becomes
 * superseded and points at the new one; both stay on file. Returns the new agreement's ID.
 */
export async function recordAgreement(
  input: AgreementInput,
  operator: OperatorContext,
): Promise<{ agreementId: string; supersededId: string | null }> {
  const check = checkAgreementFile({ name: input.filename, size: input.content.length, head: input.content });
  if (!check.ok) throw new PracticeError(check.error);
  const today = todayIn();
  if (input.expiresOn !== null && input.expiresOn < input.effectiveDate) {
    throw new PracticeError("The expiration date can't be before the effective date.");
  }
  if (input.signedOn > today) throw new PracticeError("The signed date can't be in the future.");

  const [tenant] = await systemDb()
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.id, input.tenantId), eq(tenants.kind, "customer")))
    .limit(1);
  if (!tenant) throw new PracticeError("That practice no longer exists or isn't a customer practice.");

  const agreementId = randomUUID();
  const sha256 = createHash("sha256").update(input.content).digest("hex");
  const supersededId = await systemDb().transaction(async (tx) => {
    const previous = await tx
      .update(tenantAgreements)
      .set({ status: "superseded", supersededById: agreementId })
      .where(
        and(
          eq(tenantAgreements.tenantId, input.tenantId),
          eq(tenantAgreements.kind, "baa"),
          eq(tenantAgreements.status, "active"),
        ),
      )
      .returning({ id: tenantAgreements.id });
    await tx.insert(tenantAgreements).values({
      id: agreementId,
      tenantId: input.tenantId,
      kind: "baa",
      status: "active",
      effectiveDate: input.effectiveDate,
      expiresOn: input.expiresOn,
      signedOn: input.signedOn,
      practiceSigner: input.practiceSigner,
      ourSigner: input.ourSigner,
      templateVersion: input.templateVersion,
      note: input.note,
      filename: input.filename,
      contentType: "application/pdf",
      sizeBytes: input.content.length,
      sha256,
      content: input.content,
      recordedBy: operator.userId,
    });
    return previous[0]?.id ?? null;
  });
  await auditSystem({
    action: "operator.agreement_recorded",
    actorUserId: operator.userId,
    tenantId: input.tenantId,
    entityType: "tenant_agreement",
    entityId: agreementId,
    metadata: { supersededId, templateVersion: input.templateVersion, sizeBytes: input.content.length },
  });
  return { agreementId, supersededId };
}

/** Every agreement on file for a practice, newest first, without the file contents. */
export async function listAgreements(tenantId: string): Promise<AgreementRow[]> {
  return systemDb()
    .select(listColumns)
    .from(tenantAgreements)
    .where(eq(tenantAgreements.tenantId, tenantId))
    .orderBy(desc(tenantAgreements.createdAt));
}

/** Active agreement dates for every practice (for the practices list's status column). */
export async function activeAgreementsByTenant(): Promise<Map<string, ActiveAgreementDates>> {
  const rows = await systemDb()
    .select({
      tenantId: tenantAgreements.tenantId,
      effectiveDate: tenantAgreements.effectiveDate,
      expiresOn: tenantAgreements.expiresOn,
    })
    .from(tenantAgreements)
    .where(and(eq(tenantAgreements.kind, "baa"), eq(tenantAgreements.status, "active")));
  return new Map(rows.map((r) => [r.tenantId, { effectiveDate: r.effectiveDate, expiresOn: r.expiresOn }]));
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
    .limit(1);
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
