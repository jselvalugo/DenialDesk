import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { OperatorContext } from "@/auth/operator";
import { tenants, universityAccess } from "@/db/schema";
import { withTenantAsPlatform } from "@/db/tenant";
import { PracticeError } from "@/domain/platform/errors";
import { practiceColumns, type UniversityAccessRow } from "@/domain/university/access";
import { audit } from "@/lib/audit";

/**
 * The platform operator's side of DenialDesk University access (docs/specs/denialdesk-university.md,
 * "Access"): grant when a customer practice has bought it, revoke with a reason. Owner-role writes
 * under the tenant policy; every statement names the practice explicitly. Operator console only:
 * nothing under src/app/(app) may import this module.
 */
export interface UniversityAccessRecord extends UniversityAccessRow {
  note: string | null;
  revokeReason: string | null;
}

const operatorColumns = {
  ...practiceColumns,
  note: universityAccess.note,
  revokeReason: universityAccess.revokeReason,
};

async function assertCustomer(
  tx: Parameters<Parameters<typeof withTenantAsPlatform>[1]>[0],
  tenantId: string,
) {
  const [practice] = await tx
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.kind, "customer")))
    .limit(1);
  if (!practice) throw new PracticeError("errors.practiceNotFound");
}

/** The operator records that the practice bought access; a revoked grant can be granted again. */
export async function grantUniversityAccess(
  input: { tenantId: string; note: string | null },
  operator: OperatorContext,
): Promise<void> {
  const note = input.note?.trim() || null;
  await withTenantAsPlatform({ tenantId: input.tenantId, userId: operator.userId }, async (tx) => {
    await assertCustomer(tx, input.tenantId);
    // A stale tab must not overwrite an active grant (and its order reference).
    const [existing] = await tx
      .select({ grantedAt: universityAccess.grantedAt, revokedAt: universityAccess.revokedAt })
      .from(universityAccess)
      .where(eq(universityAccess.tenantId, input.tenantId))
      .limit(1);
    if (existing?.grantedAt && !existing.revokedAt)
      throw new PracticeError("errors.universityAlreadyGranted");
    const now = new Date();
    const [row] = await tx
      .insert(universityAccess)
      .values({ tenantId: input.tenantId, grantedAt: now, grantedBy: operator.userId, note })
      .onConflictDoUpdate({
        target: universityAccess.tenantId,
        set: {
          grantedAt: now,
          grantedBy: operator.userId,
          note,
          revokedAt: null,
          revokedBy: null,
          revokeReason: null,
          updatedAt: now,
        },
      })
      .returning({ id: universityAccess.id });
    await audit(tx, {
      action: "operator.university_access_granted",
      actorUserId: operator.userId,
      tenantId: input.tenantId,
      entityType: "university_access",
      entityId: row!.id,
      metadata: { hasNote: note !== null },
    });
  });
}

const MIN_REVOKE_REASON_LENGTH = 5;

/** The operator ends the practice's access, once, with a reason kept on the row and in the audit trail. */
export async function revokeUniversityAccess(
  input: { tenantId: string; reason: string },
  operator: OperatorContext,
): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < MIN_REVOKE_REASON_LENGTH)
    throw new PracticeError("errors.universityRevokeReasonTooShort");
  await withTenantAsPlatform({ tenantId: input.tenantId, userId: operator.userId }, async (tx) => {
    await assertCustomer(tx, input.tenantId);
    const now = new Date();
    const updated = await tx
      .update(universityAccess)
      .set({ revokedAt: now, revokedBy: operator.userId, revokeReason: reason, updatedAt: now })
      // Only a granted, not-yet-revoked row: a second revoke would overwrite the first reason.
      .where(
        and(
          eq(universityAccess.tenantId, input.tenantId),
          isNotNull(universityAccess.grantedAt),
          isNull(universityAccess.revokedAt),
        ),
      )
      .returning({ id: universityAccess.id });
    if (updated.length === 0) {
      throw new PracticeError("errors.universityNotGranted");
    }
    await audit(tx, {
      action: "operator.university_access_revoked",
      actorUserId: operator.userId,
      tenantId: input.tenantId,
      entityType: "university_access",
      entityId: updated[0]!.id,
      reason,
    });
  });
}

/** The operator's read of a practice's row, with the note and revoke reason. */
export async function getUniversityAccessForOperator(
  tenantId: string,
  operator: OperatorContext,
): Promise<UniversityAccessRecord | null> {
  return withTenantAsPlatform({ tenantId, userId: operator.userId }, async (tx) => {
    const [row] = await tx
      .select(operatorColumns)
      .from(universityAccess)
      .where(eq(universityAccess.tenantId, tenantId))
      .limit(1);
    return row ?? null;
  });
}
