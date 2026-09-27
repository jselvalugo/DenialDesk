import { eq, sql } from "drizzle-orm";
import type { OperatorContext } from "@/auth/operator";
import { universityAccess } from "@/db/schema";
import { withTenantAsPlatform, type TenantTx } from "@/db/tenant";
import { PracticeError } from "@/domain/platform/errors";
import { audit } from "@/lib/audit";
import { UNIVERSITY_ACCESS_FROM_CENTS } from "./offer";

/**
 * DenialDesk University access per practice (docs/specs/denialdesk-university.md, "Access"). The
 * courses are locked until the platform operator records that the practice bought access; a
 * practice user can only request it. The Wiki is not gated.
 */
export interface UniversityAccessRow {
  requestedAt: Date | null;
  grantedAt: Date | null;
  revokedAt: Date | null;
  revokeReason: string | null;
  note: string | null;
}

export type UniversityAccessState = "none" | "requested" | "granted" | "revoked";

/** Granted and not revoked. */
export function hasUniversityAccess(row: UniversityAccessRow | null): boolean {
  return row !== null && row.grantedAt !== null && row.revokedAt === null;
}

export function universityAccessState(row: UniversityAccessRow | null): UniversityAccessState {
  if (!row) return "none";
  if (row.revokedAt) return "revoked";
  if (row.grantedAt) return "granted";
  return row.requestedAt ? "requested" : "none";
}

const columns = {
  requestedAt: universityAccess.requestedAt,
  grantedAt: universityAccess.grantedAt,
  revokedAt: universityAccess.revokedAt,
  revokeReason: universityAccess.revokeReason,
  note: universityAccess.note,
};

/**
 * The practice's access row. Filtered by tenant explicitly as well as by the policy: a superuser
 * connection (local development, CI) bypasses row-level security.
 */
export async function getUniversityAccess(
  tx: TenantTx,
  tenantId: string,
): Promise<UniversityAccessRow | null> {
  const [row] = await tx
    .select(columns)
    .from(universityAccess)
    .where(eq(universityAccess.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

/**
 * Records that a user of the practice asked for access: one row per practice, the latest request
 * wins, audited each time (`university.access_requested`). Never touches grant columns (the app
 * role has no privilege on them).
 */
export async function requestUniversityAccess(
  tx: TenantTx,
  input: { tenantId: string; userId: string },
): Promise<UniversityAccessRow> {
  // Explicit column list: the app role holds INSERT/UPDATE privileges on the request columns
  // only, and a Drizzle insert would name every column (with DEFAULT) and be refused.
  await tx.execute(sql`
    insert into university_access (tenant_id, requested_at, requested_by)
    values (${input.tenantId}, now(), ${input.userId})
    on conflict (tenant_id) do update
      set requested_at = excluded.requested_at, requested_by = excluded.requested_by, updated_at = now()
  `);
  await audit(tx, {
    action: "university.access_requested",
    actorUserId: input.userId,
    tenantId: input.tenantId,
    entityType: "university_access",
    entityId: input.tenantId,
    metadata: { priceFromCents: UNIVERSITY_ACCESS_FROM_CENTS },
  });
  return (await getUniversityAccess(tx, input.tenantId))!;
}

/** The operator records that the practice bought access; a revoked grant can be granted again. */
export async function grantUniversityAccess(
  input: { tenantId: string; note: string | null },
  operator: OperatorContext,
): Promise<void> {
  const note = input.note?.trim() || null;
  await withTenantAsPlatform({ tenantId: input.tenantId, userId: operator.userId }, async (tx) => {
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

/** The operator ends the practice's access, with a reason kept on the row and in the audit trail. */
export async function revokeUniversityAccess(
  input: { tenantId: string; reason: string },
  operator: OperatorContext,
): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < MIN_REVOKE_REASON_LENGTH)
    throw new PracticeError("errors.universityRevokeReasonTooShort");
  await withTenantAsPlatform({ tenantId: input.tenantId, userId: operator.userId }, async (tx) => {
    const now = new Date();
    const updated = await tx
      .update(universityAccess)
      .set({ revokedAt: now, revokedBy: operator.userId, revokeReason: reason, updatedAt: now })
      .where(eq(universityAccess.tenantId, input.tenantId))
      .returning({ id: universityAccess.id, grantedAt: universityAccess.grantedAt });
    if (updated.length === 0 || updated[0]!.grantedAt === null) {
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

/** The operator's read of a practice's row (owner role under the tenant policy). */
export async function getUniversityAccessForOperator(
  tenantId: string,
  operator: OperatorContext,
): Promise<UniversityAccessRow | null> {
  return withTenantAsPlatform({ tenantId, userId: operator.userId }, (tx) =>
    getUniversityAccess(tx, tenantId),
  );
}
