import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, ne } from "drizzle-orm";
import { addCalendarDays, todayIn } from "@rules/calendar";
import { closeDatabase } from "@/db/client";
import { claims, denials } from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { withTenant } from "@/db/tenant";
import { ACTION_STATUSES } from "@/domain/denial-status";
import { DUE_SOON_DAYS, listDenials, PAGE_SIZE, queueSummary } from "@/domain/denials/queries";
import { generateDataset } from "@/domain/synthetic/generator";

const today = todayIn();
let ctx: { tenantId: string; userId: string };

beforeAll(async () => {
  const { tenantId, userIds } = await seedPractice({
    practiceName: `Queue test ${Date.now()} (synthetic)`,
    asOf: today,
    users: [{ email: `queue-${Date.now()}@synthetic.test`, displayName: "Queue Tester", role: "specialist" }],
    dataset: generateDataset({ asOf: today, seed: 99, patients: 20, claims: 120 }),
  });
  ctx = { tenantId, userId: userIds[0]! };
});

afterAll(() => closeDatabase());

describe("queue summary deadline boundaries", () => {
  it("counts overdue, due-soon, and excludes filed appeals", async () => {
    const summary = await withTenant(ctx, async (tx) => {
      const rows = await tx.select({ id: denials.id }).from(denials).limit(6);
      const ids = rows.map((r) => r.id);
      await tx.update(denials).set({ status: "closed" }).where(ne(denials.id, ids[0]!));
      const set = (id: string, status: "new" | "appeal_submitted", deadline: string | null) =>
        tx.update(denials).set({ status, appealDeadline: deadline }).where(eq(denials.id, id));
      await set(ids[0]!, "new", addCalendarDays(today, -1)); // overdue (day after)
      await set(ids[1]!, "new", today); // due today → due soon (day of)
      await set(ids[2]!, "new", addCalendarDays(today, DUE_SOON_DAYS)); // last day of window
      await set(ids[3]!, "new", addCalendarDays(today, DUE_SOON_DAYS + 1)); // just outside window
      await set(ids[4]!, "appeal_submitted", addCalendarDays(today, -1)); // filed: not overdue
      await set(ids[5]!, "new", null); // no deadline configured
      return queueSummary(tx, today);
    });
    expect(summary).toMatchObject({ open: 6, overdue: 1, dueSoon: 2, noDeadline: 1 });
  });
});

describe("listDenials", () => {
  it("reports the filtered total, not the page size", async () => {
    await withTenant(ctx, (tx) => tx.update(denials).set({ status: "new" }));
    const { allByPayer, result } = await withTenant(ctx, async (tx) => {
      const all = await tx
        .select({ payerId: claims.payerId })
        .from(denials)
        .innerJoin(claims, eq(claims.id, denials.claimId));
      const payerId = all[0]!.payerId;
      const allByPayer = all.filter((row) => row.payerId === payerId).length;
      const result = await listDenials(
        tx,
        { status: "open", payerId, sort: "deadline", page: 1 },
        ctx.userId,
      );
      return { allByPayer, result };
    });
    expect(result.total).toBe(allByPayer);
    expect(result.rows.length).toBe(Math.min(allByPayer, PAGE_SIZE));
  });

  it("sorts by deadline with no-deadline rows last, awaiting-action denials first (D1)", async () => {
    const { rows } = await withTenant(ctx, (tx) =>
      listDenials(tx, { status: "all", sort: "deadline", page: 1 }, ctx.userId),
    );
    // Awaiting-action denials (deadline not yet met) sort ahead of ones whose deadline is already
    // met (e.g. appeal_submitted), even when the latter's deadline is sooner.
    const awaiting = new Set(ACTION_STATUSES as readonly string[]);
    const firstHandled = rows.findIndex((r) => !awaiting.has(r.status));
    if (firstHandled !== -1) {
      expect(rows.slice(0, firstHandled).every((r) => awaiting.has(r.status))).toBe(true);
      expect(rows.slice(firstHandled).every((r) => !awaiting.has(r.status))).toBe(true);
    }
    for (const group of [
      rows.slice(0, firstHandled === -1 ? rows.length : firstHandled),
      rows.slice(firstHandled === -1 ? rows.length : firstHandled),
    ]) {
      const deadlines = group.map((r) => r.appealDeadline);
      const firstNull = deadlines.indexOf(null);
      const dated = (firstNull === -1 ? deadlines : deadlines.slice(0, firstNull)) as string[];
      expect(dated).toEqual([...dated].sort());
      if (firstNull !== -1) expect(deadlines.slice(firstNull).every((d) => d === null)).toBe(true);
    }
  });

  it("filters to unassigned", async () => {
    const { rows } = await withTenant(ctx, (tx) =>
      listDenials(tx, { status: "all", assignee: "unassigned", sort: "deadline", page: 1 }, ctx.userId),
    );
    expect(rows.every((r) => r.assigneeName === null)).toBe(true);
  });

  it("sorts by denied amount, in either direction, with a stable id tie-break (P4)", async () => {
    const { asc: ascResult, desc: descResult } = await withTenant(ctx, async (tx) => {
      const asc = await listDenials(tx, { status: "all", sort: "amount", dir: "asc", page: 1 }, ctx.userId);
      const desc = await listDenials(tx, { status: "all", sort: "amount", dir: "desc", page: 1 }, ctx.userId);
      return { asc, desc };
    });
    // A `dir` flip never changes the filtered total, only the order the pages come back in.
    expect(descResult.total).toBe(ascResult.total);
    // Ordered by amount, with ties (same denied amount) always broken id-ascending, in either
    // direction, so paging is deterministic (P4: "Add a stable tie-breaker").
    for (const [rows, sign] of [
      [ascResult.rows, 1],
      [descResult.rows, -1],
    ] as const) {
      for (let i = 1; i < rows.length; i += 1) {
        const cmp = (rows[i]!.deniedCents - rows[i - 1]!.deniedCents) * sign;
        expect(cmp).toBeGreaterThanOrEqual(0);
        if (cmp === 0) expect(rows[i - 1]!.id < rows[i]!.id).toBe(true);
      }
    }
  });

  it("breaks a deliberate amount tie by id ascending, regardless of sort direction (P4 review)", async () => {
    const { tiedIds, ascRows, descRows } = await withTenant(ctx, async (tx) => {
      const grouped = await tx
        .select({ payerId: claims.payerId, id: denials.id })
        .from(denials)
        .innerJoin(claims, eq(claims.id, denials.claimId));
      const byPayer = new Map<string, string[]>();
      for (const row of grouped) byPayer.set(row.payerId, [...(byPayer.get(row.payerId) ?? []), row.id]);
      const [payerId, tiedIds] = [...byPayer.entries()].find(
        ([, ids]) => ids.length >= 3 && ids.length <= 20,
      )!;
      // Force every one of this payer's denials to the exact same denied amount.
      await tx.update(denials).set({ deniedCents: 424_242 }).where(inArray(denials.id, tiedIds));
      const ascResult = await listDenials(
        tx,
        { status: "all", payerId, sort: "amount", dir: "asc", page: 1 },
        ctx.userId,
      );
      const descResult = await listDenials(
        tx,
        { status: "all", payerId, sort: "amount", dir: "desc", page: 1 },
        ctx.userId,
      );
      return { payerId, tiedIds, ascRows: ascResult.rows, descRows: descResult.rows };
    });
    expect(tiedIds.length).toBeGreaterThanOrEqual(3);
    const sortedIds = [...tiedIds].sort();
    // Every row is tied on amount, so both directions fall through to the same id-ascending order.
    expect(ascRows.map((r) => r.id)).toEqual(sortedIds);
    expect(descRows.map((r) => r.id)).toEqual(sortedIds);
    expect(ascRows.every((r) => r.deniedCents === 424_242)).toBe(true);
  });

  it("holds the awaiting-action-first priority for a descending deadline sort too, with nulls last (P4 review)", async () => {
    const { targetIds, rows } = await withTenant(ctx, async (tx) => {
      const grouped = await tx
        .select({ payerId: claims.payerId, id: denials.id })
        .from(denials)
        .innerJoin(claims, eq(claims.id, denials.claimId));
      const byPayer = new Map<string, string[]>();
      for (const row of grouped) byPayer.set(row.payerId, [...(byPayer.get(row.payerId) ?? []), row.id]);
      const [payerId, ids] = [...byPayer.entries()].find(([, list]) => list.length >= 3)!;
      const [handledLaterDeadline, awaitingEarlierDeadline, awaitingNoDeadline] = ids;
      await tx
        .update(denials)
        .set({ status: "appeal_submitted", appealDeadline: addCalendarDays(today, 10) })
        .where(eq(denials.id, handledLaterDeadline!));
      await tx
        .update(denials)
        .set({ status: "new", appealDeadline: addCalendarDays(today, 2) })
        .where(eq(denials.id, awaitingEarlierDeadline!));
      await tx
        .update(denials)
        .set({ status: "new", appealDeadline: null })
        .where(eq(denials.id, awaitingNoDeadline!));
      const result = await listDenials(
        tx,
        { status: "all", payerId, sort: "deadline", dir: "desc", page: 1 },
        ctx.userId,
      );
      return {
        targetIds: {
          handledLaterDeadline: handledLaterDeadline!,
          awaitingEarlierDeadline: awaitingEarlierDeadline!,
          awaitingNoDeadline: awaitingNoDeadline!,
        },
        rows: result.rows,
      };
    });
    const indexOf = (id: string) => rows.findIndex((r) => r.id === id);
    // Still needs work (awaiting action) sorts ahead of already-handled, even with a later deadline —
    // the D1 priority holds for `dir=desc` too, not only the ascending default.
    expect(indexOf(targetIds.awaitingEarlierDeadline)).toBeLessThan(indexOf(targetIds.handledLaterDeadline));
    // Within the awaiting-action group, a null deadline still sorts last, even sorting "descending".
    expect(indexOf(targetIds.awaitingNoDeadline)).toBeGreaterThan(indexOf(targetIds.awaitingEarlierDeadline));
  });

  it("sorts by notice date, in either direction (restored, P4 review)", async () => {
    const { asc: ascResult, desc: descResult } = await withTenant(ctx, async (tx) => {
      const asc = await listDenials(tx, { status: "all", sort: "notice", dir: "asc", page: 1 }, ctx.userId);
      const desc = await listDenials(tx, { status: "all", sort: "notice", dir: "desc", page: 1 }, ctx.userId);
      return { asc, desc };
    });
    expect(descResult.total).toBe(ascResult.total);
    const ascDates = ascResult.rows.map((r) => r.noticeDate);
    expect(ascDates).toEqual([...ascDates].sort());
    const descDates = descResult.rows.map((r) => r.noticeDate);
    expect(descDates).toEqual([...descDates].sort().reverse());
  });
});
