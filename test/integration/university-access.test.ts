import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import type { OperatorContext } from "@/auth/operator";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, universityAccess } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  getUniversityAccess,
  getUniversityAccessForOperator,
  grantUniversityAccess,
  hasUniversityAccess,
  requestUniversityAccess,
  revokeUniversityAccess,
  universityAccessState,
} from "@/domain/university/access";
import { PracticeError } from "@/domain/platform/errors";
import { createTestTenant, expectDbError } from "./helpers";

// docs/specs/denialdesk-university.md "Access": a practice can only request; the operator grants
// and revokes; the row is tenant-scoped (R-7.2.4) and every change is audited (R-7.5.1).

let ctx: { tenantId: string; userId: string };
let other: { tenantId: string; userId: string };
let operator: OperatorContext;

beforeAll(async () => {
  ctx = await createTestTenant("University access");
  other = await createTestTenant("University access other");
  // Any user row serves as the operator identity here; the console's own account is provisioned
  // from hosting configuration.
  const op = await createTestTenant("Operator home");
  operator = {
    sessionId: "test",
    userId: op.userId,
    email: "operator@synthetic.test",
    displayName: "Operator",
  };
});

afterAll(() => closeDatabase());

async function auditRows(action: string, tenantId: string) {
  return systemDb()
    .select({
      entityType: auditEvents.entityType,
      metadata: auditEvents.metadata,
      reason: auditEvents.reason,
    })
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.action, action as never)))
    .orderBy(desc(auditEvents.occurredAt));
}

describe("university access", () => {
  it("starts locked, with no row", async () => {
    const row = await withTenant(ctx, (tx) => getUniversityAccess(tx, ctx.tenantId));
    expect(row).toBeNull();
    expect(hasUniversityAccess(row)).toBe(false);
    expect(universityAccessState(row)).toBe("none");
  });

  it("a practice user can request access; the request is one row per practice and audited", async () => {
    const first = await withTenant(ctx, (tx) => requestUniversityAccess(tx, ctx));
    expect(first.requestedAt).not.toBeNull();
    expect(hasUniversityAccess(first)).toBe(false);
    expect(universityAccessState(first)).toBe("requested");

    const again = await withTenant(ctx, (tx) => requestUniversityAccess(tx, ctx));
    expect(again.requestedAt!.getTime()).toBeGreaterThanOrEqual(first.requestedAt!.getTime());
    const rows = await systemDb()
      .select({ id: universityAccess.id })
      .from(universityAccess)
      .where(eq(universityAccess.tenantId, ctx.tenantId));
    expect(rows).toHaveLength(1);

    const events = await auditRows("university.access_requested", ctx.tenantId);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      entityType: "university_access",
      metadata: { priceFromCents: 29900 },
      reason: null,
    });
  });

  it("a practice session can never grant itself access (column privileges)", async () => {
    await expectDbError(
      withTenant(ctx, (tx) =>
        tx
          .update(universityAccess)
          .set({ grantedAt: new Date(), grantedBy: ctx.userId })
          .where(eq(universityAccess.tenantId, ctx.tenantId)),
      ),
      /permission denied/,
    );
    await expectDbError(
      withTenant(other, (tx) =>
        tx
          .insert(universityAccess)
          .values({ tenantId: other.tenantId, grantedAt: new Date(), grantedBy: other.userId }),
      ),
      /permission denied/,
    );
  });

  it("is invisible to another practice, which cannot request on its behalf", async () => {
    const seen = await withTenant(other, (tx) => getUniversityAccess(tx, other.tenantId));
    expect(seen).toBeNull();
    // Explicit columns, as the domain does: the policy's WITH CHECK refuses the other tenant's id.
    await expectDbError(
      withTenant(other, (tx) =>
        tx.execute(
          sql`insert into university_access (tenant_id, requested_at, requested_by)
              values (${ctx.tenantId}, now(), ${other.userId})`,
        ),
      ),
      /row-level security/,
    );
  });

  it("the operator grants access, which unlocks the practice, and it is audited", async () => {
    await grantUniversityAccess({ tenantId: ctx.tenantId, note: "  SYN-order-1 " }, operator);
    const row = await withTenant(ctx, (tx) => getUniversityAccess(tx, ctx.tenantId));
    expect(hasUniversityAccess(row)).toBe(true);
    expect(universityAccessState(row)).toBe("granted");
    expect(row!.note).toBe("SYN-order-1");
    // The request is kept on the same row.
    expect(row!.requestedAt).not.toBeNull();
    expect(await getUniversityAccessForOperator(ctx.tenantId, operator)).toEqual(row);

    const events = await auditRows("operator.university_access_granted", ctx.tenantId);
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata).toEqual({ hasNote: true });
    // Nothing leaked to the other practice.
    expect(await withTenant(other, (tx) => getUniversityAccess(tx, other.tenantId))).toBeNull();
  });

  it("revoking needs a reason and locks the practice again; granting again re-opens it", async () => {
    await expect(
      revokeUniversityAccess({ tenantId: ctx.tenantId, reason: "no" }, operator),
    ).rejects.toBeInstanceOf(PracticeError);
    await revokeUniversityAccess(
      { tenantId: ctx.tenantId, reason: "Subscription ended (synthetic)." },
      operator,
    );
    const revoked = await withTenant(ctx, (tx) => getUniversityAccess(tx, ctx.tenantId));
    expect(hasUniversityAccess(revoked)).toBe(false);
    expect(universityAccessState(revoked)).toBe("revoked");
    expect(revoked!.revokeReason).toBe("Subscription ended (synthetic).");
    const events = await auditRows("operator.university_access_revoked", ctx.tenantId);
    expect(events[0]!.reason).toBe("Subscription ended (synthetic).");

    await grantUniversityAccess({ tenantId: ctx.tenantId, note: null }, operator);
    const regranted = await withTenant(ctx, (tx) => getUniversityAccess(tx, ctx.tenantId));
    expect(hasUniversityAccess(regranted)).toBe(true);
    expect(regranted!.revokedAt).toBeNull();
    expect(regranted!.revokeReason).toBeNull();
  });

  it("revoking a practice that was never granted is refused", async () => {
    await expect(
      revokeUniversityAccess({ tenantId: other.tenantId, reason: "Nothing to revoke here." }, operator),
    ).rejects.toBeInstanceOf(PracticeError);
  });
});
