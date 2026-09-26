import { and, asc, desc, eq } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { claimLines, claims, claimVersions, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { changedFields, snapshotOf, type Correction } from "./correction";
import { isUnsubmitted } from "./status";

export class ClaimCorrectionError extends Error {
  constructor(message: string) {
    super(message);
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
  if (!claim) throw new ClaimCorrectionError("Claim not found.");
  if (!isUnsubmitted(claim.status)) {
    throw new ClaimCorrectionError("Only draft or rejected claims can be corrected.");
  }
  if (claim.version !== input.expectedVersion) {
    throw new ClaimCorrectionError("This claim changed since you opened it. Reload and try again.");
  }
  const { correction } = input;
  if (correction.serviceDate > input.today) {
    throw new ClaimCorrectionError("The date of service can't be in the future.");
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
    throw new ClaimCorrectionError("Lines can be corrected but not added or removed.");
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
  if (changes.length === 0) throw new ClaimCorrectionError("Nothing changed.");

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
