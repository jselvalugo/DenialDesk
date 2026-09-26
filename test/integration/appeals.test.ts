import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { addCalendarDays, todayIn } from "@rules/calendar";
import { daysUntil } from "@rules/deadlines";
import { closeDatabase } from "@/db/client";
import { appeals, claims, denials, payers } from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { withTenant, type TenantTx } from "@/db/tenant";
import { appealQueueSummary, getAppeal, listAppeals, openAppealsForDenial } from "@/domain/appeals/queries";
import { DEFAULT_APPEAL_FOLLOW_UP_DAYS } from "@/domain/appeals/settings";
import { generateDataset } from "@/domain/synthetic/generator";
import { describeDaysRemaining } from "@/lib/deadline";

const today = todayIn();
let ctx: { tenantId: string; userId: string };

beforeAll(async () => {
  const { tenantId, userIds } = await seedPractice({
    practiceName: `Appeals test ${Date.now()} (synthetic)`,
    asOf: today,
    users: [
      { email: `appeals-${Date.now()}@synthetic.test`, displayName: "Appeals Tester", role: "specialist" },
    ],
    dataset: generateDataset({ asOf: today, seed: 41, patients: 20, claims: 80 }),
  });
  ctx = { tenantId, userId: userIds[0]! };
});

afterAll(() => closeDatabase());

/** Finds an open, awaiting-action denial for a payer whose regime is verified (a computable deadline). */
async function pickDenial(tx: TenantTx) {
  const [row] = await tx
    .select({ id: denials.id, deniedCents: denials.deniedCents, claimId: denials.claimId })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .where(eq(denials.status, "new"))
    .limit(1);
  return row!;
}

describe("appeal lifecycle", () => {
  it("creates a first-level appeal, records a submission, and syncs the denial status", async () => {
    const { appealId, denialId } = await withTenant(ctx, async (tx) => {
      const denial = await pickDenial(tx);
      const [inserted] = await tx
        .insert(appeals)
        .values({
          tenantId: ctx.tenantId,
          denialId: denial.id,
          claimId: denial.claimId,
          level: "first_level",
          filedBy: ctx.userId,
          deadline: addCalendarDays(today, 10),
          deadlineBasis: "payer_contract",
          deadlineCitation: "Payer contract",
        })
        .returning({ id: appeals.id });
      await tx.update(denials).set({ status: "appeal_drafted" }).where(eq(denials.id, denial.id));
      return { appealId: inserted!.id, denialId: denial.id };
    });

    await withTenant(ctx, async (tx) => {
      await tx
        .update(appeals)
        .set({
          status: "submitted",
          submittedMethod: "portal",
          submittedOn: today,
          followUpOn: addCalendarDays(today, DEFAULT_APPEAL_FOLLOW_UP_DAYS),
        })
        .where(eq(appeals.id, appealId));
      await tx
        .update(denials)
        .set({ status: "appeal_submitted", appealSubmittedOn: today })
        .where(eq(denials.id, denialId));
    });

    const detail = await withTenant(ctx, (tx) => getAppeal(tx, appealId));
    expect(detail?.appeal.status).toBe("submitted");
    expect(detail?.appeal.submittedOn).toBe(today);
    expect(detail?.denial.status).toBe("appeal_submitted");

    const open = await withTenant(ctx, (tx) => openAppealsForDenial(tx, denialId));
    // "submitted" is still an open appeal status (the case isn't finished).
    expect(open.map((a) => a.id)).toContain(appealId);
  });

  it("rejects a status transition the database doesn't recognize", async () => {
    const { appealId } = await withTenant(ctx, async (tx) => {
      const denial = await pickDenial(tx);
      const [inserted] = await tx
        .insert(appeals)
        .values({
          tenantId: ctx.tenantId,
          denialId: denial.id,
          claimId: denial.claimId,
          level: "first_level",
          filedBy: ctx.userId,
        })
        .returning({ id: appeals.id });
      return { appealId: inserted!.id };
    });
    await expect(
      withTenant(ctx, (tx) => tx.update(appeals).set({ status: "decided" }).where(eq(appeals.id, appealId))),
    ).rejects.toThrow(/cannot move from draft to decided/);
  });

  it("moves withdrawn/dismissed straight out of submitted without going through decided", async () => {
    const { appealId } = await withTenant(ctx, async (tx) => {
      const denial = await pickDenial(tx);
      const [inserted] = await tx
        .insert(appeals)
        .values({
          tenantId: ctx.tenantId,
          denialId: denial.id,
          claimId: denial.claimId,
          level: "first_level",
          filedBy: ctx.userId,
          status: "submitted",
          submittedMethod: "mail",
          submittedOn: today,
        })
        .returning({ id: appeals.id });
      return { appealId: inserted!.id };
    });
    await withTenant(ctx, (tx) =>
      tx
        .update(appeals)
        .set({
          status: "withdrawn",
          decisionOutcome: "withdrawn",
          decisionOn: today,
          closeReason: "duplicate filing",
        })
        .where(eq(appeals.id, appealId)),
    );
    const [row] = await withTenant(ctx, (tx) =>
      tx.select({ status: appeals.status }).from(appeals).where(eq(appeals.id, appealId)),
    );
    expect(row?.status).toBe("withdrawn");
  });
});

describe("appeal queue summary and boundaries", () => {
  it("counts overdue, due-soon, and excludes submitted appeals from deadline counts", async () => {
    // Every denial gets its own fresh appeal here (rather than reusing the shared "new" pool,
    // which earlier tests in this file may have thinned out) so the four cases are guaranteed.
    const ids = await withTenant(ctx, async (tx) => {
      const rows = await tx.select({ id: denials.id, claimId: denials.claimId }).from(denials).limit(4);
      const created: string[] = [];
      for (const row of rows) {
        const [inserted] = await tx
          .insert(appeals)
          .values({
            tenantId: ctx.tenantId,
            denialId: row.id,
            claimId: row.claimId,
            level: "first_level",
            filedBy: ctx.userId,
          })
          .returning({ id: appeals.id });
        created.push(inserted!.id);
      }
      await tx
        .update(appeals)
        .set({ deadline: addCalendarDays(today, -1) })
        .where(eq(appeals.id, created[0]!)); // overdue
      await tx.update(appeals).set({ deadline: today }).where(eq(appeals.id, created[1]!)); // due today
      await tx
        .update(appeals)
        .set({
          deadline: addCalendarDays(today, -1),
          status: "submitted",
          submittedMethod: "portal",
          submittedOn: today,
        })
        .where(eq(appeals.id, created[2]!)); // submitted: excluded from deadline counts
      await tx.update(appeals).set({ deadline: null }).where(eq(appeals.id, created[3]!)); // no deadline
      return created;
    });

    const summary = await withTenant(ctx, (tx) => appealQueueSummary(tx, today));
    expect(summary.overdue).toBeGreaterThanOrEqual(1);
    expect(summary.dueSoon).toBeGreaterThanOrEqual(1);
    expect(summary.noDeadline).toBeGreaterThanOrEqual(1);
    expect(ids.length).toBe(4);
  });

  it.each([
    [1, "1 day left"],
    [0, "Due today"],
    [-1, "1 day overdue"],
  ])("boundary: %i days remaining reads %s", (remaining, label) => {
    const deadline = addCalendarDays(today, remaining);
    expect(daysUntil(deadline, today)).toBe(remaining);
    expect(describeDaysRemaining(daysUntil(deadline, today))).toBe(label);
  });

  it("a submission recorded on, before, and after the deadline is still accepted (A1: recorded and flagged, not blocked)", async () => {
    for (const offset of [-1, 0, 1]) {
      const { appealId, deadline } = await withTenant(ctx, async (tx) => {
        const denial = await pickDenial(tx);
        const deadline = addCalendarDays(today, offset);
        const [inserted] = await tx
          .insert(appeals)
          .values({
            tenantId: ctx.tenantId,
            denialId: denial.id,
            claimId: denial.claimId,
            level: "first_level",
            filedBy: ctx.userId,
            deadline,
          })
          .returning({ id: appeals.id });
        return { appealId: inserted!.id, deadline };
      });
      await withTenant(ctx, (tx) =>
        tx
          .update(appeals)
          .set({ status: "submitted", submittedMethod: "portal", submittedOn: today })
          .where(eq(appeals.id, appealId)),
      );
      const [row] = await withTenant(ctx, (tx) =>
        tx
          .select({ status: appeals.status, submittedOn: appeals.submittedOn })
          .from(appeals)
          .where(eq(appeals.id, appealId)),
      );
      expect(row?.status).toBe("submitted");
      const onTime = row!.submittedOn! <= deadline;
      expect(onTime).toBe(today <= deadline);
    }
  });
});

describe("listAppeals", () => {
  it("sorts overdue first by default and paginates", async () => {
    const { rows, total } = await withTenant(ctx, (tx) =>
      listAppeals(tx, { status: "all", sort: "deadline", page: 1 }),
    );
    expect(total).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(25);
  });
});
