import "server-only";
import { randomBytes } from "node:crypto";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { hashPassword } from "@/auth/password";
import type { OperatorContext } from "@/auth/operator";
import { systemDb } from "@/db/client";
import { denials, memberships, tenants, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { OPEN_STATUSES } from "@/domain/denial-status";
import { auditSystem } from "@/lib/audit";

// Platform operator actions (specs: docs/specs/operator-login.md, demo-login-and-operator-console.md).
// Practice-level metadata and counts only; never patient or claim data.

export interface PracticeSummary {
  id: string;
  name: string;
  kind: "customer" | "demo";
  suspendedAt: Date | null;
  createdAt: Date;
  teamSize: number;
  openDenials: number;
}

export async function listPractices(operator: OperatorContext): Promise<PracticeSummary[]> {
  const rows = await systemDb()
    .select({
      id: tenants.id,
      name: tenants.name,
      kind: tenants.kind,
      suspendedAt: tenants.suspendedAt,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .orderBy(desc(tenants.createdAt));
  const teams = await systemDb()
    .select({ tenantId: memberships.tenantId, size: count() })
    .from(memberships)
    .groupBy(memberships.tenantId);
  const teamSize = new Map(teams.map((t) => [t.tenantId, t.size]));

  // Denial counts run inside each practice's own tenant context, so row-level security still applies.
  return Promise.all(
    rows.map(async (row) => {
      const [result] = await withTenant({ tenantId: row.id, userId: operator.userId }, (tx) =>
        tx.select({ open: count() }).from(denials).where(inArray(denials.status, OPEN_STATUSES)),
      );
      return { ...row, teamSize: teamSize.get(row.id) ?? 0, openDenials: result?.open ?? 0 };
    }),
  );
}

export class PracticeError extends Error {}

/** Creates a customer practice and its first admin. Returns a one-time temporary password. */
export async function createPractice(
  input: { name: string; adminName: string; adminEmail: string },
  operator: OperatorContext,
): Promise<{ tenantId: string; temporaryPassword: string }> {
  const [existing] = await systemDb()
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${input.adminEmail})`)
    .limit(1);
  if (existing) throw new PracticeError("An account with that email already exists.");

  const temporaryPassword = randomBytes(12).toString("base64url");
  const passwordHash = await hashPassword(temporaryPassword);
  const tenantId = await systemDb()
    .transaction(async (tx) => {
      const [tenant] = await tx.insert(tenants).values({ name: input.name, kind: "customer" }).returning();
      const [admin] = await tx
        .insert(users)
        .values({
          email: input.adminEmail,
          displayName: input.adminName,
          passwordHash,
          mustChangePassword: true,
        })
        .returning();
      await tx.insert(memberships).values({ tenantId: tenant!.id, userId: admin!.id, role: "admin" });
      return tenant!.id;
    })
    .catch((error: unknown) => {
      // Two operators' submissions racing on the same email hit the unique index.
      if ((error as { cause?: { code?: string } })?.cause?.code === "23505") {
        throw new PracticeError("An account with that email already exists.");
      }
      throw error;
    });
  await auditSystem({
    action: "operator.practice_created",
    actorUserId: operator.userId,
    tenantId,
    entityType: "tenant",
    entityId: tenantId,
  });
  return { tenantId, temporaryPassword };
}

export async function setPracticeSuspended(
  tenantId: string,
  suspended: boolean,
  operator: OperatorContext,
): Promise<void> {
  const updated = await systemDb()
    .update(tenants)
    .set({ suspendedAt: suspended ? new Date() : null })
    // Customer practices only: legacy demo practices were archived when the demo was removed.
    .where(and(eq(tenants.id, tenantId), eq(tenants.kind, "customer")))
    .returning({ id: tenants.id });
  if (updated.length === 0)
    throw new PracticeError("That practice no longer exists or isn't a customer practice.");
  await auditSystem({
    action: suspended ? "operator.practice_suspended" : "operator.practice_reactivated",
    actorUserId: operator.userId,
    tenantId,
    entityType: "tenant",
    entityId: tenantId,
  });
}
