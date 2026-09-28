import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, ne } from "drizzle-orm";
import { addCalendarDays, todayIn } from "@rules/calendar";
import { closeDatabase } from "@/db/client";
import { claims, denials, payers } from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { withTenant } from "@/db/tenant";
import { ACTION_STATUSES } from "@/domain/denial-status";
import { DUE_SOON_DAYS, listDenials, PAGE_SIZE, queueSummary } from "@/domain/denials/queries";
import { generateDataset } from "@/domain/synthetic/generator";
import { uuidWithPrefix } from "./helpers";

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

type FreshDenial = Partial<
  Pick<typeof denials.$inferInsert, "status" | "appealDeadline" | "deniedCents" | "noticeDate">
> & {
  id: string;
};

/**
 * Fresh denials on one new claim under a payer of their own (P4 review): a sort test filters by the
 * returned `payerId` and reads only these rows, instead of mutating the seeded denials other tests
 * in this file count. Returns the ids in the order given.
 */
async function freshDenials(specs: FreshDenial[]): Promise<{ payerId: string; ids: string[] }> {
  return withTenant(ctx, async (tx) => {
    const [template] = await tx.select().from(claims).limit(1);
    const [payer] = await tx
      .insert(payers)
      .values({ tenantId: ctx.tenantId, name: `Queue sort payer ${randomUUID().slice(0, 8)}` })
      .returning({ id: payers.id });
    const [claim] = await tx
      .insert(claims)
      .values({
        tenantId: ctx.tenantId,
        claimNumber: `QS-${randomUUID().slice(0, 8)}`,
        patientId: template!.patientId,
        providerId: template!.providerId,
        locationId: template!.locationId,
        payerId: payer!.id,
        serviceDate: addCalendarDays(today, -45),
        diagnosisCodes: template!.diagnosisCodes,
        billedCents: template!.billedCents,
        status: "denied",
      })
      .returning({ id: claims.id });
    for (const spec of specs) {
      await tx.insert(denials).values({
        tenantId: ctx.tenantId,
        claimId: claim!.id,
        groupCode: "CO",
        carc: "16",
        category: "missing_information",
        deniedCents: 10_000,
        noticeDate: addCalendarDays(today, -15),
        status: "new",
        ...spec,
      });
    }
    return { payerId: payer!.id, ids: specs.map((spec) => spec.id) };
  });
}

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
    const tied = { deniedCents: 424_242, noticeDate: addCalendarDays(today, -20) };
    // Inserted out of id order, so neither insertion (heap) order nor a flipped tie-break passes.
    const { payerId, ids } = await freshDenials([
      { ...tied, id: uuidWithPrefix("c") },
      { ...tied, id: uuidWithPrefix("a") },
      { ...tied, id: uuidWithPrefix("b") },
    ]);
    const { ascRows, descRows } = await withTenant(ctx, async (tx) => {
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
      return { ascRows: ascResult.rows, descRows: descResult.rows };
    });
    const sortedIds = [ids[1]!, ids[2]!, ids[0]!];
    // Every row is tied on amount, so both directions fall through to the same id-ascending order.
    expect(ascRows.map((r) => r.id)).toEqual(sortedIds);
    expect(descRows.map((r) => r.id)).toEqual(sortedIds);
    expect(ascRows.every((r) => r.deniedCents === 424_242)).toBe(true);
  });

  it("holds the awaiting-action-first priority for a descending deadline sort too, with nulls last (P4 review)", async () => {
    // Ids are not in the expected order (which is id-descending), so an id-ascending order fails too.
    const { payerId, ids } = await freshDenials([
      { id: uuidWithPrefix("1"), status: "appeal_submitted", appealDeadline: addCalendarDays(today, 10) },
      { id: uuidWithPrefix("3"), status: "new", appealDeadline: addCalendarDays(today, 2) },
      { id: uuidWithPrefix("2"), status: "new", appealDeadline: null },
    ]);
    const [handledLaterDeadline, awaitingEarlierDeadline, awaitingNoDeadline] = ids;
    const { rows } = await withTenant(ctx, (tx) =>
      listDenials(tx, { status: "all", payerId, sort: "deadline", dir: "desc", page: 1 }, ctx.userId),
    );
    // Still needs work (awaiting action) sorts ahead of already-handled, even with a later deadline —
    // the D1 priority holds for `dir=desc` too, not only the ascending default. Within the
    // awaiting-action group, a null deadline still sorts last, even sorting "descending".
    expect(rows.map((r) => r.id)).toEqual([
      awaitingEarlierDeadline,
      awaitingNoDeadline,
      handledLaterDeadline,
    ]);
  });

  it("sorts by notice date, in either direction (restored, P4 review)", async () => {
    // Distinct notice dates, inserted out of date order, with ids running opposite to date order:
    // the ascending check fails for a missing sort (id order) or a flipped one, and the descending
    // check for a flipped one.
    const { payerId, ids } = await freshDenials([
      { id: uuidWithPrefix("2"), noticeDate: addCalendarDays(today, -20) },
      { id: uuidWithPrefix("3"), noticeDate: addCalendarDays(today, -30) },
      { id: uuidWithPrefix("0"), noticeDate: addCalendarDays(today, -5) },
      { id: uuidWithPrefix("1"), noticeDate: addCalendarDays(today, -10) },
    ]);
    const { asc: ascResult, desc: descResult } = await withTenant(ctx, async (tx) => {
      const asc = await listDenials(
        tx,
        { status: "all", payerId, sort: "notice", dir: "asc", page: 1 },
        ctx.userId,
      );
      const desc = await listDenials(
        tx,
        { status: "all", payerId, sort: "notice", dir: "desc", page: 1 },
        ctx.userId,
      );
      return { asc, desc };
    });
    expect(ascResult.total).toBe(4);
    expect(descResult.total).toBe(4);
    const oldestFirst = [ids[1]!, ids[0]!, ids[3]!, ids[2]!];
    expect(ascResult.rows.map((r) => r.id)).toEqual(oldestFirst);
    expect(descResult.rows.map((r) => r.id)).toEqual([...oldestFirst].reverse());
  });
});
