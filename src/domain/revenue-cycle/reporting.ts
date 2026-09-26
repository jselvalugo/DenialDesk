import { eq, inArray, sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { claims, denials, glAccounts, payerClasses, payers, rcmClaimLines, rcmFiles } from "@/db/schema";
import { OPEN_STATUSES } from "@/domain/denial-status";
import { audit } from "@/lib/audit";
import { periodFiles } from "./periods";
import { receivablesReport } from "./receivables";
import { denialsByClass, incomeStatement, kpis, type AccountTotal } from "./statements";
import type { Actor } from "./vouchers";

// Statements and dashboard queries (docs/specs/revenue-cycle-accounting.md, B5). Totals only,
// but built from PHI lines, so every view that returns figures is audited (R-7.5.1).

/** The 12 most recent months that have a current-format file (months without files are skipped). */
async function recentPeriods(tx: TenantTx) {
  return (await periodFiles(tx)).slice(-12);
}

async function recordView(
  tx: TenantTx,
  actor: Actor,
  report: "statements" | "rcm_dashboard",
  months: number,
) {
  await audit(tx, {
    action: "rcm.report_viewed",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    metadata: { report, months },
  });
}

export async function statementsReport(tx: TenantTx, actor: Actor) {
  const periods = await recentPeriods(tx);
  if (periods.length === 0) return null;
  const fileIds = periods.map((p) => p.fileId);
  const monthOf = new Map(
    periods.map((p) => [p.fileId, { periodYear: p.periodYear, periodMonth: p.periodMonth }]),
  );
  // One transaction client: queries run one after another.
  const chargeRows = await tx
    .select({
      fileId: rcmClaimLines.fileId,
      account: rcmClaimLines.revenueGl,
      cents: sql<number>`sum(${rcmClaimLines.billedCents})::bigint`.mapWith(Number),
    })
    .from(rcmClaimLines)
    .where(inArray(rcmClaimLines.fileId, fileIds))
    .groupBy(rcmClaimLines.fileId, rcmClaimLines.revenueGl);
  const adjustmentRows = await tx
    .select({
      fileId: rcmClaimLines.fileId,
      account: rcmClaimLines.adjustmentGl,
      cents: sql<number>`sum(${rcmClaimLines.adjustmentCents})::bigint`.mapWith(Number),
    })
    .from(rcmClaimLines)
    .where(inArray(rcmClaimLines.fileId, fileIds))
    .groupBy(rcmClaimLines.fileId, rcmClaimLines.adjustmentGl);
  const arRows = await tx
    .select({
      account: rcmClaimLines.arGl,
      openCents:
        sql<number>`coalesce(sum(${rcmClaimLines.balanceCents}) filter (where ${rcmClaimLines.balanceCents} > 0), 0)::bigint`.mapWith(
          Number,
        ),
      creditCents:
        sql<number>`coalesce(sum(${rcmClaimLines.balanceCents}) filter (where ${rcmClaimLines.balanceCents} < 0), 0)::bigint`.mapWith(
          Number,
        ),
    })
    .from(rcmClaimLines)
    .where(eq(rcmClaimLines.fileId, periods.at(-1)!.fileId))
    .groupBy(rcmClaimLines.arGl);
  const accounts = await tx.select({ number: glAccounts.number, name: glAccounts.name }).from(glAccounts);
  const receivables = await receivablesReport(tx);
  const names = new Map(accounts.map((a) => [a.number, a.name]));
  const toTotals = (rows: Array<{ fileId: string; account: string; cents: number }>): AccountTotal[] =>
    rows.map((r) => ({ ...monthOf.get(r.fileId)!, account: r.account, cents: r.cents }));
  const months = periods.map((p) => ({ periodYear: p.periodYear, periodMonth: p.periodMonth }));
  const shown = new Set(months.map((m) => `${m.periodYear}-${m.periodMonth}`));
  await recordView(tx, actor, "statements", months.length);
  return {
    income: incomeStatement(months, toTotals(chargeRows), toTotals(adjustmentRows), names),
    receivables: arRows
      .map((r) => ({ ...r, name: names.get(r.account) ?? "Not in the chart of accounts" }))
      .sort((a, b) => (a.account < b.account ? -1 : 1)),
    asOf: receivables!.asOf,
    cash: receivables!.reconciliation.filter((r) => shown.has(`${r.periodYear}-${r.periodMonth}`)),
  };
}

export async function dashboardReport(tx: TenantTx, actor: Actor) {
  const periods = await recentPeriods(tx);
  if (periods.length === 0) return null;
  const files = await tx
    .select({
      id: rcmFiles.id,
      netRevenueCents: rcmFiles.netCents,
      paymentsCents: rcmFiles.paymentCents,
    })
    .from(rcmFiles)
    .where(
      inArray(
        rcmFiles.id,
        periods.map((p) => p.fileId),
      ),
    );
  const receivables = await receivablesReport(tx);
  const openDenials = await tx
    .select({
      regime: payers.regime,
      count: sql<number>`count(*)::int`,
      deniedCents: sql<number>`sum(${denials.deniedCents})::bigint`.mapWith(Number),
    })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .where(inArray(denials.status, OPEN_STATUSES))
    .groupBy(payers.regime);
  const classes = await tx
    .select({ code: payerClasses.code, regime: payerClasses.regime })
    .from(payerClasses);
  const byId = new Map(files.map((f) => [f.id, f]));
  const months = periods.map((p) => ({
    periodYear: p.periodYear,
    periodMonth: p.periodMonth,
    ...byId.get(p.fileId)!,
  }));
  const deniedCents = openDenials.reduce((t, d) => t + d.deniedCents, 0);
  await recordView(tx, actor, "rcm_dashboard", months.length);
  return {
    months,
    kpis: kpis(months, receivables!.aging.totals.totalCents)!,
    aging: receivables!.aging,
    reconciliation: receivables!.reconciliation,
    denials: {
      count: openDenials.reduce((t, d) => t + d.count, 0),
      deniedCents,
      byClass: denialsByClass(openDenials, classes),
    },
  };
}
