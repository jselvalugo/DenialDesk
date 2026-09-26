import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { closeDatabase } from "@/db/client";
import { auditEvents, denials, payerClasses, rcmClaimLines, rcmFiles } from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { withTenant } from "@/db/tenant";
import { OPEN_STATUSES } from "@/domain/denial-status";
import { periodFiles } from "@/domain/revenue-cycle/periods";
import { dashboardReport, statementsReport } from "@/domain/revenue-cycle/reporting";
import type { Actor } from "@/domain/revenue-cycle/vouchers";
import { generateDataset } from "@/domain/synthetic/generator";

let a: Actor;
let b: Actor;

async function practice(label: string, seed: number): Promise<Actor> {
  const suffix = `${label}-${Date.now()}-${seed}`;
  const { tenantId, userIds } = await seedPractice({
    practiceName: `RCM reporting ${suffix} (synthetic)`,
    asOf: todayIn(),
    users: [{ email: `rep-mgr-${suffix}@synthetic.test`, displayName: "RCM Manager", role: "manager" }],
    dataset: generateDataset({ asOf: todayIn(), seed, patients: 4, claims: 20 }),
  });
  return { tenantId, userId: userIds[0]!, role: "manager" };
}

beforeAll(async () => {
  a = await practice("alpha", 61);
  b = await practice("beta", 62);
});

afterAll(() => closeDatabase());

describe("statementsReport", () => {
  it("nets to each month's file and ties receivables to the latest file's balances", async () => {
    const { report, periods, files, balances } = await withTenant(a, async (tx) => {
      const periods = await periodFiles(tx);
      const ids = periods.map((p) => p.fileId);
      return {
        report: (await statementsReport(tx, a))!,
        periods,
        files: await tx
          .select({ id: rcmFiles.id, net: rcmFiles.netCents })
          .from(rcmFiles)
          .where(inArray(rcmFiles.id, ids)),
        balances: await tx
          .select({
            open: sql<number>`coalesce(sum(${rcmClaimLines.balanceCents}) filter (where ${rcmClaimLines.balanceCents} > 0), 0)::bigint`.mapWith(
              Number,
            ),
            credit:
              sql<number>`coalesce(sum(${rcmClaimLines.balanceCents}) filter (where ${rcmClaimLines.balanceCents} < 0), 0)::bigint`.mapWith(
                Number,
              ),
          })
          .from(rcmClaimLines)
          .where(eq(rcmClaimLines.fileId, ids.at(-1)!)),
      };
    });
    expect(periods.length).toBeGreaterThan(0);
    const netByFile = new Map(files.map((f) => [f.id, f.net]));
    expect(report.income.netCents).toEqual(periods.map((p) => netByFile.get(p.fileId)));
    expect(report.income.revenue.length).toBeGreaterThan(0);
    expect(report.income.revenue.every((r) => r.name !== "Not in the chart of accounts")).toBe(true);

    const [latest] = balances;
    expect(report.receivables.reduce((t, r) => t + r.openCents, 0)).toBe(latest!.open);
    expect(report.receivables.reduce((t, r) => t + r.creditCents, 0)).toBe(latest!.credit);
    expect(report.cash.length).toBeLessThanOrEqual(periods.length);
  });
});

describe("dashboardReport", () => {
  it("reports the latest month and every open denial, matched to a class by regime", async () => {
    const { report, periods, open, classes } = await withTenant(a, async (tx) => ({
      report: (await dashboardReport(tx, a))!,
      periods: await periodFiles(tx),
      open: await tx
        .select({
          count: sql<number>`count(*)::int`,
          cents: sql<number>`coalesce(sum(${denials.deniedCents}), 0)::bigint`.mapWith(Number),
        })
        .from(denials)
        .where(inArray(denials.status, OPEN_STATUSES)),
      classes: await tx.select({ code: payerClasses.code, regime: payerClasses.regime }).from(payerClasses),
    }));
    const last = periods.at(-1)!;
    expect(report.kpis.latest).toEqual({ periodYear: last.periodYear, periodMonth: last.periodMonth });
    expect(report.months).toHaveLength(periods.length);

    expect(report.denials.count).toBe(open[0]!.count);
    expect(report.denials.deniedCents).toBe(open[0]!.cents);
    expect(report.denials.byClass.reduce((t, d) => t + d.count, 0)).toBe(open[0]!.count);
    expect(report.denials.byClass.reduce((t, d) => t + d.deniedCents, 0)).toBe(open[0]!.cents);
    const codes = new Set(classes.map((c) => c.code));
    expect(report.denials.byClass.every((d) => d.payerClass === "Unmapped" || codes.has(d.payerClass))).toBe(
      true,
    );
    // Starter classes carry their regulatory regime; self-pay has none.
    expect(classes.find((c) => c.code === "MCR")?.regime).toBe("medicare");
    expect(classes.find((c) => c.code === "SELF")?.regime).toBeNull();
  });

  it("only sees the practice's own figures", async () => {
    const [mine, theirs, theirFiles] = await Promise.all([
      withTenant(a, (tx) => dashboardReport(tx, a)),
      withTenant(b, (tx) => dashboardReport(tx, b)),
      withTenant(b, (tx) => tx.select({ net: rcmFiles.netCents, id: rcmFiles.id }).from(rcmFiles)),
    ]);
    const theirIds = new Set(theirFiles.map((f) => f.id));
    expect(mine!.months.every((m) => !theirIds.has(m.id))).toBe(true);
    expect(theirs!.months.every((m) => theirIds.has(m.id))).toBe(true);
    // Denials too: each practice counts only its own open denials.
    const theirOpen = await withTenant(b, (tx) =>
      tx.select({ id: denials.id }).from(denials).where(inArray(denials.status, OPEN_STATUSES)),
    );
    expect(theirOpen.length).toBeGreaterThan(0);
    expect(theirs!.denials.count).toBe(theirOpen.length);
    const myOpen = await withTenant(a, (tx) =>
      tx.select({ id: denials.id }).from(denials).where(inArray(denials.status, OPEN_STATUSES)),
    );
    expect(mine!.denials.count).toBe(myOpen.length);
  });
});

describe("report views", () => {
  it("are audited with the report and month count, never figures", async () => {
    const views = () =>
      withTenant(a, (tx) =>
        tx
          .select({ metadata: auditEvents.metadata, actor: auditEvents.actorUserId })
          .from(auditEvents)
          .where(and(eq(auditEvents.action, "rcm.report_viewed"), eq(auditEvents.actorUserId, a.userId)))
          .orderBy(auditEvents.id),
      );
    const before = (await views()).length;
    const months = (await withTenant(a, (tx) => periodFiles(tx))).length;
    await withTenant(a, (tx) => statementsReport(tx, a));
    await withTenant(a, (tx) => dashboardReport(tx, a));
    const after = await views();
    expect(after).toHaveLength(before + 2);
    expect(after.slice(-2).map((v) => v.metadata)).toEqual(
      expect.arrayContaining([
        { report: "statements", months },
        { report: "rcm_dashboard", months },
      ]),
    );
  });
});
