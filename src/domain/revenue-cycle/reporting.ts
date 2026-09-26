import { eq, inArray, sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { claims, denials, glAccounts, payerClasses, payers, rcmClaimLines, rcmFiles } from "@/db/schema";
import { OPEN_STATUSES } from "@/domain/denial-status";
import { periodFiles } from "./periods";
import { receivablesReport } from "./receivables";
import { denialsByClass, incomeStatement, kpis, type AccountTotal } from "./statements";

// Statements and dashboard queries (docs/specs/revenue-cycle-accounting.md, B5). Totals only.

/** Up to the last 12 months that have a current-format file. */
async function recentPeriods(tx: TenantTx) {
  return (await periodFiles(tx)).slice(-12);
}

export async function statementsReport(tx: TenantTx) {
  const periods = await recentPeriods(tx);
  if (periods.length === 0) return null;
  const fileIds = periods.map((p) => p.fileId);
  const monthOf = new Map(
    periods.map((p) => [p.fileId, { periodYear: p.periodYear, periodMonth: p.periodMonth }]),
  );
  const [chargeRows, adjustmentRows, arRows, accounts, receivables] = await Promise.all([
    tx
      .select({
        fileId: rcmClaimLines.fileId,
        account: rcmClaimLines.revenueGl,
        cents: sql<number>`sum(${rcmClaimLines.billedCents})::bigint`.mapWith(Number),
      })
      .from(rcmClaimLines)
      .where(inArray(rcmClaimLines.fileId, fileIds))
      .groupBy(rcmClaimLines.fileId, rcmClaimLines.revenueGl),
    tx
      .select({
        fileId: rcmClaimLines.fileId,
        account: rcmClaimLines.adjustmentGl,
        cents: sql<number>`sum(${rcmClaimLines.adjustmentCents})::bigint`.mapWith(Number),
      })
      .from(rcmClaimLines)
      .where(inArray(rcmClaimLines.fileId, fileIds))
      .groupBy(rcmClaimLines.fileId, rcmClaimLines.adjustmentGl),
    tx
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
      .groupBy(rcmClaimLines.arGl),
    tx.select({ number: glAccounts.number, name: glAccounts.name }).from(glAccounts),
    receivablesReport(tx),
  ]);
  const names = new Map(accounts.map((a) => [a.number, a.name]));
  const toTotals = (rows: Array<{ fileId: string; account: string; cents: number }>): AccountTotal[] =>
    rows.map((r) => ({ ...monthOf.get(r.fileId)!, account: r.account, cents: r.cents }));
  const months = periods.map((p) => ({ periodYear: p.periodYear, periodMonth: p.periodMonth }));
  const shown = new Set(months.map((m) => `${m.periodYear}-${m.periodMonth}`));
  return {
    income: incomeStatement(months, toTotals(chargeRows), toTotals(adjustmentRows), names),
    receivables: arRows
      .map((r) => ({ ...r, name: names.get(r.account) ?? "Not in the chart of accounts" }))
      .sort((a, b) => (a.account < b.account ? -1 : 1)),
    asOf: receivables!.asOf,
    cash: receivables!.reconciliation.filter((r) => shown.has(`${r.periodYear}-${r.periodMonth}`)),
  };
}

export async function dashboardReport(tx: TenantTx) {
  const periods = await recentPeriods(tx);
  if (periods.length === 0) return null;
  const [files, receivables, openDenials, classes] = await Promise.all([
    tx
      .select({
        id: rcmFiles.id,
        netRevenueCents: rcmFiles.netCents,
        paymentsCents: rcmFiles.paymentCents,
        balanceCents: rcmFiles.balanceCents,
      })
      .from(rcmFiles)
      .where(
        inArray(
          rcmFiles.id,
          periods.map((p) => p.fileId),
        ),
      ),
    receivablesReport(tx),
    tx
      .select({
        regime: payers.regime,
        count: sql<number>`count(*)::int`,
        deniedCents: sql<number>`sum(${denials.deniedCents})::bigint`.mapWith(Number),
      })
      .from(denials)
      .innerJoin(claims, eq(claims.id, denials.claimId))
      .innerJoin(payers, eq(payers.id, claims.payerId))
      .where(inArray(denials.status, OPEN_STATUSES))
      .groupBy(payers.regime),
    tx.select({ code: payerClasses.code, regime: payerClasses.regime }).from(payerClasses),
  ]);
  const byId = new Map(files.map((f) => [f.id, f]));
  const months = periods.map((p) => ({
    periodYear: p.periodYear,
    periodMonth: p.periodMonth,
    ...byId.get(p.fileId)!,
  }));
  const deniedCents = openDenials.reduce((t, d) => t + d.deniedCents, 0);
  return {
    months,
    kpis: kpis(months)!,
    aging: receivables!.aging,
    reconciliation: receivables!.reconciliation,
    denials: {
      count: openDenials.reduce((t, d) => t + d.count, 0),
      deniedCents,
      byClass: denialsByClass(openDenials, classes),
    },
  };
}
