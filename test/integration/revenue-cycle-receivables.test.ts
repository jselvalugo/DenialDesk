import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, gt, sql } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { closeDatabase } from "@/db/client";
import { auditEvents, rcmClaimLines, rcmDepositFiles, rcmDeposits } from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { withTenant } from "@/db/tenant";
import { parseDepositFile } from "@/domain/revenue-cycle/aging";
import { importDeposits, receivablesReport, DepositError } from "@/domain/revenue-cycle/receivables";
import type { Actor } from "@/domain/revenue-cycle/vouchers";
import { generateDataset } from "@/domain/synthetic/generator";
import { expectDbError } from "./helpers";

interface Practice {
  tenantId: string;
  manager: Actor;
  compliance: Actor;
}
let a: Practice;
let b: Practice;

async function practice(label: string, seed: number): Promise<Practice> {
  const suffix = `${label}-${Date.now()}-${seed}`;
  const { tenantId, userIds } = await seedPractice({
    practiceName: `RCM receivables ${suffix} (synthetic)`,
    asOf: todayIn(),
    users: [
      { email: `ar-mgr-${suffix}@synthetic.test`, displayName: "RCM Manager", role: "manager" },
      { email: `ar-comp-${suffix}@synthetic.test`, displayName: "Compliance", role: "compliance" },
    ],
    dataset: generateDataset({ asOf: todayIn(), seed, patients: 3, claims: 6 }),
  });
  return {
    tenantId,
    manager: { tenantId, userId: userIds[0]!, role: "manager" },
    compliance: { tenantId, userId: userIds[1]!, role: "compliance" },
  };
}

beforeAll(async () => {
  a = await practice("alpha", 51);
  b = await practice("beta", 52);
});

afterAll(() => closeDatabase());

describe("receivables report", () => {
  it("ages the latest month, ties every month, and reconciles seeded deposits", async () => {
    const report = (await withTenant(a.manager, (tx) => receivablesReport(tx)))!;
    expect(report.periods).toHaveLength(3);
    expect(report.selected).toEqual(report.periods.at(-1));
    expect(report.rollForward.slice(1).every((r) => r.unexplainedCents === 0)).toBe(true);

    const [open] = await withTenant(a.manager, (tx) =>
      tx
        .select({
          total: sql<number>`coalesce(sum(${rcmClaimLines.balanceCents}), 0)::bigint`.mapWith(Number),
        })
        .from(rcmClaimLines)
        .where(and(eq(rcmClaimLines.fileId, report.selected.fileId), gt(rcmClaimLines.balanceCents, 0))),
    );
    expect(report.aging.totals.totalCents).toBe(open!.total);
    expect(report.aging.rows.reduce((t, r) => t + r.totalCents, 0)).toBe(open!.total);

    // Deposits lag payments a little; the last month's lagged share is still in transit.
    expect(report.reconciliation).toHaveLength(3);
    expect(report.reconciliation.every((r) => r.depositsCents > 0)).toBe(true);
    const last = report.reconciliation.at(-1)!;
    expect(last.clearingCents).toBeGreaterThan(0);
    expect(last.clearingCents).toBeLessThan(last.paymentsCents);
  });

  it("ages an earlier month on request", async () => {
    const report = (await withTenant(a.manager, (tx) => receivablesReport(tx)))!;
    const first = report.periods[0]!;
    const earlier = (await withTenant(a.manager, (tx) =>
      receivablesReport(tx, { year: first.periodYear, month: first.periodMonth }),
    ))!;
    expect(earlier.selected).toEqual(first);
    const unknown = (await withTenant(a.manager, (tx) => receivablesReport(tx, { year: 1999, month: 1 })))!;
    expect(unknown.selected).toEqual(report.selected);
  });
});

describe("importDeposits", () => {
  it("stores dates and amounts only, audited with counts", async () => {
    const parsed = parseDepositFile(
      "Date,Description,Amount\n03/02/2026,Harbor EFT,125.00\n03/03/2026,Return,(5.00)\n",
    );
    expect(parsed.ok).toBe(true);
    const fileId = await withTenant(a.manager, (tx) =>
      importDeposits(tx, a.manager, parsed.ok ? parsed.deposits : []),
    );
    const rows = await withTenant(a.manager, (tx) =>
      tx.select().from(rcmDeposits).where(eq(rcmDeposits.fileId, fileId)),
    );
    expect(rows.map((r) => [r.depositDate, r.amountCents])).toEqual([
      ["2026-03-02", 12_500],
      ["2026-03-03", -500],
    ]);
    expect(JSON.stringify(rows)).not.toContain("Harbor");
    const [file] = await withTenant(a.manager, (tx) =>
      tx.select().from(rcmDepositFiles).where(eq(rcmDepositFiles.id, fileId)),
    );
    expect(file).toMatchObject({ rowCount: 2, totalCents: 12_000 });
    const events = await withTenant(a.manager, (tx) =>
      tx.select().from(auditEvents).where(eq(auditEvents.entityId, fileId)),
    );
    expect(events.map((e) => [e.action, e.metadata])).toEqual([["rcm.deposits_imported", { rows: 2 }]]);
  });

  it("refuses roles that don't run month-end and empty or fractional input", async () => {
    const one = [{ rowNumber: 2, depositDate: "2026-03-02", amountCents: 100 }];
    await expect(withTenant(a.compliance, (tx) => importDeposits(tx, a.compliance, one))).rejects.toThrow(
      DepositError,
    );
    await expect(withTenant(a.manager, (tx) => importDeposits(tx, a.manager, []))).rejects.toThrow(
      /no deposits/,
    );
    await expect(
      withTenant(a.manager, (tx) => importDeposits(tx, a.manager, [{ ...one[0]!, amountCents: 1.5 }])),
    ).rejects.toThrow(/whole/);
  });
});

describe("deposit records", () => {
  it("are isolated per practice, never changed or deleted, and never zero", async () => {
    for (const table of [rcmDepositFiles, rcmDeposits]) {
      const rows = await withTenant(b.manager, (tx) => tx.select({ tenantId: table.tenantId }).from(table));
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenantId === b.tenantId)).toBe(true);
      await expectDbError(
        withTenant(a.manager, (tx) => tx.update(table).set({ tenantId: a.tenantId })),
        /permission denied/,
      );
      await expectDbError(
        withTenant(a.manager, (tx) => tx.delete(table)),
        /permission denied/,
      );
    }
    const [aFile] = await withTenant(a.manager, (tx) => tx.select().from(rcmDepositFiles).limit(1));
    await expectDbError(
      withTenant(a.manager, (tx) =>
        tx.insert(rcmDeposits).values({
          tenantId: a.tenantId,
          fileId: aFile!.id,
          rowNumber: 99_999,
          depositDate: "2026-03-01",
          amountCents: 0,
        }),
      ),
      /nonzero/,
    );
    await expectDbError(
      withTenant(a.manager, (tx) =>
        tx
          .insert(rcmDepositFiles)
          .values({ tenantId: b.tenantId, uploadedBy: a.manager.userId, rowCount: 0, totalCents: 0 }),
      ),
      /row-level security/,
    );
  });
});
