import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import type { OperatorContext } from "@/auth/operator";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, tenants, universityAccess } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  getUniversityAccessForOperator,
  grantUniversityAccess,
  revokeUniversityAccess,
} from "@/domain/platform/university-access";
import {
  getUniversityAccess,
  hasUniversityAccess,
  requestUniversityAccess,
  pendingRequestAt,
  practiceColumns,
  universityAccessState,
} from "@/domain/university/access";
import { completedLessons, completeLessonIfUnlocked } from "@/domain/university/queries";
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
    expect(again.requestedAt!.getTime()).toBe(first.requestedAt!.getTime());
    const rows = await systemDb()
      .select({ id: universityAccess.id })
      .from(universityAccess)
      .where(eq(universityAccess.tenantId, ctx.tenantId));
    expect(rows).toHaveLength(1);

    const events = await auditRows("university.access_requested", ctx.tenantId);
    expect(events).toHaveLength(1);
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
    // Unfiltered and pointed at ctx's row: the policy alone must hide it (R-7.2.4).
    const all = await withTenant(other, (tx) => tx.select(practiceColumns).from(universityAccess));
    expect(all).toHaveLength(0);
    expect(await withTenant(other, (tx) => getUniversityAccess(tx, ctx.tenantId))).toBeNull();
    const touched = await withTenant(other, (tx) =>
      tx
        .update(universityAccess)
        .set({ requestedAt: new Date(), requestedBy: other.userId })
        .where(eq(universityAccess.tenantId, ctx.tenantId))
        .returning({ id: universityAccess.id }),
    );
    expect(touched).toHaveLength(0);
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
    // The request is kept on the same row; the note is the operator's to read, not the practice's.
    expect(row!.requestedAt).not.toBeNull();
    expect(row).not.toHaveProperty("note");
    const record = await getUniversityAccessForOperator(ctx.tenantId, operator);
    expect(record).toMatchObject({ ...row, note: "SYN-order-1", revokeReason: null });
    await expectDbError(
      withTenant(ctx, (tx) => tx.select({ note: universityAccess.note }).from(universityAccess)),
      /permission denied/,
    );

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
    expect(pendingRequestAt(revoked)).toBeNull();
    expect((await getUniversityAccessForOperator(ctx.tenantId, operator))!.revokeReason).toBe(
      "Subscription ended (synthetic).",
    );
    const events = await auditRows("operator.university_access_revoked", ctx.tenantId);
    expect(events[0]!.reason).toBe("Subscription ended (synthetic).");
    // Only once: a second revoke is refused and the first reason stays.
    await expect(
      revokeUniversityAccess({ tenantId: ctx.tenantId, reason: "Second revoke attempt." }, operator),
    ).rejects.toBeInstanceOf(PracticeError);
    expect((await getUniversityAccessForOperator(ctx.tenantId, operator))!.revokeReason).toBe(
      "Subscription ended (synthetic).",
    );

    // The practice asks again after the revoke: a new pending request the operator can see.
    const rerequested = await withTenant(ctx, (tx) => requestUniversityAccess(tx, ctx));
    expect(universityAccessState(rerequested)).toBe("requested");
    expect(pendingRequestAt(rerequested)).not.toBeNull();
    expect(hasUniversityAccess(rerequested)).toBe(false);

    await grantUniversityAccess({ tenantId: ctx.tenantId, note: null }, operator);
    const regranted = await withTenant(ctx, (tx) => getUniversityAccess(tx, ctx.tenantId));
    expect(hasUniversityAccess(regranted)).toBe(true);
    expect(pendingRequestAt(regranted)).toBeNull();
    expect(regranted!.revokedAt).toBeNull();
    expect((await getUniversityAccessForOperator(ctx.tenantId, operator))!.revokeReason).toBeNull();
    // A second grant while access is active is refused (a stale tab can't erase the reference).
    await expect(
      grantUniversityAccess({ tenantId: ctx.tenantId, note: "SYN-stale" }, operator),
    ).rejects.toBeInstanceOf(PracticeError);
  });

  it("grants are limited to customer practices", async () => {
    const { tenantId } = await createTestTenant("Archived demo");
    await systemDb()
      .update(tenants)
      .set({ kind: "demo", suspendedAt: new Date() })
      .where(eq(tenants.id, tenantId));
    await expect(grantUniversityAccess({ tenantId, note: null }, operator)).rejects.toBeInstanceOf(
      PracticeError,
    );
  });

  it("a repeated request within a minute, or one from a practice with access, is not written again", async () => {
    const fresh = await createTestTenant("University repeat");
    const first = await withTenant(fresh, (tx) => requestUniversityAccess(tx, fresh));
    const again = await withTenant(fresh, (tx) => requestUniversityAccess(tx, fresh));
    expect(again.requestedAt!.getTime()).toBe(first.requestedAt!.getTime());
    expect(await auditRows("university.access_requested", fresh.tenantId)).toHaveLength(1);

    await grantUniversityAccess({ tenantId: fresh.tenantId, note: null }, operator);
    await withTenant(fresh, (tx) => requestUniversityAccess(tx, fresh));
    expect(await auditRows("university.access_requested", fresh.tenantId)).toHaveLength(1);
  });

  it("records lesson progress only while the practice has access (server-side guard)", async () => {
    const locked = await createTestTenant("University locked");
    const lesson = { courseId: "getting-started", lessonId: "finding-your-way" };
    const refused = await withTenant(locked, (tx) => completeLessonIfUnlocked(tx, { ...locked, ...lesson }));
    expect(refused).toBeNull();
    expect(await withTenant(locked, (tx) => completedLessons(tx, locked.userId))).toHaveProperty("size", 0);

    await grantUniversityAccess({ tenantId: locked.tenantId, note: null }, operator);
    const done = await withTenant(locked, (tx) => completeLessonIfUnlocked(tx, { ...locked, ...lesson }));
    expect(done?.inserted).toBe(true);

    await revokeUniversityAccess({ tenantId: locked.tenantId, reason: "Synthetic revoke." }, operator);
    const afterRevoke = await withTenant(locked, (tx) =>
      completeLessonIfUnlocked(tx, { ...locked, courseId: "getting-started", lessonId: "the-claim-path" }),
    );
    expect(afterRevoke).toBeNull();
  });

  it("revoking a requested-but-never-granted practice is refused with a clear error", async () => {
    const requestedOnly = await createTestTenant("University requested only");
    await withTenant(requestedOnly, (tx) => requestUniversityAccess(tx, requestedOnly));
    await expect(
      revokeUniversityAccess({ tenantId: requestedOnly.tenantId, reason: "Never granted here." }, operator),
    ).rejects.toThrow(PracticeError);
  });

  it("revoking a practice that was never granted is refused", async () => {
    await expect(
      revokeUniversityAccess({ tenantId: other.tenantId, reason: "Nothing to revoke here." }, operator),
    ).rejects.toBeInstanceOf(PracticeError);
  });
});
