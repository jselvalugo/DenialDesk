import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canViewRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { BarList } from "@/components/ui/BarList";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatTile } from "@/components/ui/StatTile";
import { withTenant } from "@/db/tenant";
import { over90Cents, over90ShareBps, OVER_90_WARNING_SHARE_BPS } from "@/domain/revenue-cycle/aging";
import { periodLabel } from "@/domain/revenue-cycle/imports";
import { dashboardReport } from "@/domain/revenue-cycle/reporting";
import { getT } from "@/i18n/server";
import { formatCents } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("revenue");
  return { title: t("dashboard.title") };
}

const percent = (bps: number) => `${(bps / 100).toFixed(1)}%`;

export default async function RcmDashboardPage() {
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  const t = await getT("revenue");
  // The report records the view (R-7.5.1).
  const report = await withTenant(auth, (tx) => dashboardReport(tx, auth));

  if (!report) {
    return (
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
        <PageHeader title={t("dashboard.title")} description={t("dashboard.description")} />
        <Panel>
          <EmptyState title={t("dashboard.emptyTitle")} description={t("dashboard.emptyDescription")} />
        </Panel>
      </div>
    );
  }

  const { kpis, aging, denials } = report;
  const over90 = over90Cents(aging.totals.buckets);
  const openAr = kpis.openArCents;
  const over90Bps = over90ShareBps(over90, openAr);
  const trailing = t("dashboard.trailingMonths", { count: kpis.trailingMonths });
  const maxRevenue = Math.max(1, ...report.months.map((m) => m.netRevenueCents));
  const clearing = report.reconciliation.at(-1);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader
        title={t("dashboard.title")}
        description={t("dashboard.pageDescription", {
          period: periodLabel(kpis.latest.periodYear, kpis.latest.periodMonth, t.locale),
        })}
      />

      <section
        aria-label={t("dashboard.keyFigures")}
        className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6"
      >
        <StatTile
          label={t("dashboard.netRevenue")}
          value={formatCents(kpis.netRevenueCents)}
          detail={t("dashboard.netRevenueDetail")}
        />
        <StatTile
          label={t("arAging.col.payments")}
          value={formatCents(kpis.paymentsCents)}
          detail={t("dashboard.paymentsDetail")}
        />
        <StatTile
          label={t("arAging.openAr")}
          value={formatCents(openAr)}
          detail={t("dashboard.openArDetail")}
        />
        <StatTile
          label={t("dashboard.daysInAr")}
          value={kpis.daysInAr === null ? "—" : kpis.daysInAr.toFixed(1)}
          detail={t("dashboard.daysInArDetail", { trailing })}
        />
        <StatTile
          label={t("dashboard.netCollectionRate")}
          value={kpis.netCollectionBps === null ? "—" : percent(kpis.netCollectionBps)}
          detail={t("dashboard.netCollectionRateDetail", { trailing })}
        />
        <StatTile
          label={t("arAging.over90")}
          value={over90Bps === null ? "—" : percent(over90Bps)}
          detail={formatCents(over90)}
          emphasis={over90Bps !== null && over90Bps > OVER_90_WARNING_SHARE_BPS ? "warning" : undefined}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          title={t("dashboard.netRevenueByMonth")}
          description={t("dashboard.monthsWithFiles", { count: report.months.length })}
        >
          <BarList
            label={t("dashboard.netRevenueByMonth")}
            rows={report.months.map((m) => ({
              key: `${m.periodYear}-${m.periodMonth}`,
              label: periodLabel(m.periodYear, m.periodMonth, t.locale),
              value: Math.max(0, m.netRevenueCents),
              display: formatCents(m.netRevenueCents),
            }))}
          />
          <p className="mt-3 text-label text-muted">
            {t("dashboard.barsScale", { amount: formatCents(maxRevenue) })}
          </p>
        </Panel>

        <Panel title={t("dashboard.paymentsByMonth")} description={t("dashboard.postedInPm")}>
          <BarList
            label={t("dashboard.paymentsByMonth")}
            tone="chart-4"
            rows={report.months.map((m) => ({
              key: `${m.periodYear}-${m.periodMonth}`,
              label: periodLabel(m.periodYear, m.periodMonth, t.locale),
              value: Math.max(0, m.paymentsCents),
              display: formatCents(m.paymentsCents),
            }))}
          />
          {clearing && (
            <p className="mt-3 text-label text-muted">
              {clearing.clearingCents >= 0
                ? t("dashboard.postedNotDeposited", { amount: formatCents(clearing.clearingCents) })
                : t("dashboard.depositedNotPosted", { amount: formatCents(-clearing.clearingCents) })}{" "}
              <Link href="/revenue-cycle/ar-aging" className="font-medium text-link hover:underline">
                {t("dashboard.reconciliation")}
              </Link>
            </p>
          )}
        </Panel>
      </div>

      <Panel
        title={t("dashboard.openDenialsTitle")}
        description={t("dashboard.openDenialsDescription")}
        actions={
          <Link href="/denials?status=open" className="text-label font-medium text-link hover:underline">
            {t("dashboard.denialQueue")}
          </Link>
        }
        flush
      >
        {denials.count === 0 ? (
          <EmptyState
            title={t("dashboard.noOpenDenialsTitle")}
            description={t("dashboard.noOpenDenialsDescription")}
          />
        ) : (
          <>
            <Table caption={t("dashboard.openDenialsTableCaption")}>
              <thead>
                <tr>
                  <Th>{t("arAging.col.class")}</Th>
                  <Th numeric>{t("dashboard.openDenials")}</Th>
                  <Th numeric>{t("dashboard.denied")}</Th>
                </tr>
              </thead>
              <tbody>
                {denials.byClass.map((d) => (
                  <Tr key={d.payerClass}>
                    <Td>
                      {d.payerClass === "Unmapped" ? (
                        <span className="text-muted">{t("dashboard.noMatchingClass")}</span>
                      ) : (
                        <Code>{d.payerClass}</Code>
                      )}
                    </Td>
                    <Td numeric>{d.count}</Td>
                    <Td numeric>
                      <Money cents={d.deniedCents} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <p className="border-t border-border px-4 py-2.5 text-label text-muted">
              {t("dashboard.openDenialsSummary", { amount: formatCents(denials.deniedCents) })}
              {openAr > 0
                ? t("dashboard.openDenialsShare", {
                    percent: percent(Math.round((denials.deniedCents * 10_000) / openAr)),
                  })
                : "."}
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}
