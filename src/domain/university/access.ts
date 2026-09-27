import { eq, sql } from "drizzle-orm";
import { universityAccess } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import { UNIVERSITY_ACCESS_FROM_CENTS } from "./offer";

/**
 * DenialDesk University access per practice (docs/specs/denialdesk-university.md, "Access"). The
 * courses are locked until the platform operator records that the practice bought access
 * (src/domain/platform/university-access.ts); a practice user can only request it. The Wiki is
 * not gated. This module is what practice sessions may import.
 */
export interface UniversityAccessRow {
  requestedAt: Date | null;
  grantedAt: Date | null;
  revokedAt: Date | null;
}

export type UniversityAccessState = "none" | "requested" | "granted" | "revoked";

/** Granted and not revoked. */
export function hasUniversityAccess(row: UniversityAccessRow | null): boolean {
  return row !== null && row.grantedAt !== null && row.revokedAt === null;
}

/**
 * Where the practice stands. A request made after a revoke counts as a new, pending request (the
 * practice wants access again), so the operator sees "Requested", not "Revoked".
 */
export function universityAccessState(row: UniversityAccessRow | null): UniversityAccessState {
  if (!row) return "none";
  if (row.revokedAt) {
    return row.requestedAt && row.requestedAt > row.revokedAt ? "requested" : "revoked";
  }
  if (row.grantedAt) return "granted";
  return row.requestedAt ? "requested" : "none";
}

/** The date of the practice's pending request, or null when nothing is waiting on DenialDesk. */
export function pendingRequestAt(row: UniversityAccessRow | null): Date | null {
  return universityAccessState(row) === "requested" ? row!.requestedAt : null;
}

/** The columns a practice session may read (the operator's note and revoke reason are not among them). */
export const practiceColumns = {
  requestedAt: universityAccess.requestedAt,
  grantedAt: universityAccess.grantedAt,
  revokedAt: universityAccess.revokedAt,
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
    .select(practiceColumns)
    .from(universityAccess)
    .where(eq(universityAccess.tenantId, tenantId))
    .limit(1);
  return row ?? null;
}

/** A request newer than this is not written or audited again (repeat clicks, replayed posts). */
const REQUEST_REPEAT_MS = 60_000;

/**
 * Records that a user of the practice asked for access: one row per practice, the latest request
 * wins, audited (`university.access_requested`). Never touches grant columns (the app role has no
 * privilege on them).
 */
export async function requestUniversityAccess(
  tx: TenantTx,
  input: { tenantId: string; userId: string },
): Promise<UniversityAccessRow> {
  const current = await getUniversityAccess(tx, input.tenantId);
  // Nothing to ask for: the practice already has access.
  if (hasUniversityAccess(current)) return current!;
  const pending = pendingRequestAt(current);
  if (pending && Date.now() - pending.getTime() < REQUEST_REPEAT_MS) return current!;
  // Explicit column list: the app role holds INSERT/UPDATE privileges on the request columns
  // only, and a Drizzle insert would name every column (with DEFAULT) and be refused.
  const result = await tx.execute<{ id: string }>(sql`
    insert into university_access (tenant_id, requested_at, requested_by)
    values (${input.tenantId}, now(), ${input.userId})
    on conflict (tenant_id) do update
      set requested_at = excluded.requested_at, requested_by = excluded.requested_by, updated_at = now()
    returning id
  `);
  await audit(tx, {
    action: "university.access_requested",
    actorUserId: input.userId,
    tenantId: input.tenantId,
    entityType: "university_access",
    entityId: result.rows[0]!.id,
    metadata: { priceFromCents: UNIVERSITY_ACCESS_FROM_CENTS },
  });
  return (await getUniversityAccess(tx, input.tenantId))!;
}
