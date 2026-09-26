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
import { periodLabel } from "@/domain/revenue-cycle/imports";
import { dashboardReport } from "@/domain/revenue-cycle/reporting";
import { audit } from "@/lib/audit";
import { formatCents } from "@/lib/format";

export const metadata: Metadata = { title: "RCM dashboard" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const percent = (bps: number) => `${(bps / 100).toFixed(1)}%`;

export default async function RcmDashboardPage() {
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  const report = await withTenant(auth, async (tx) => {
    const result = await dashboardReport(tx);
    // Totals only, but built from PHI lines: record the view (R-7.5.1).
    if (result) {
      await audit(tx, {
        action: "rcm.report_viewed",
        actorUserId: auth.userId,
        tenantId: auth.tenantId,
        metadata: { report: "rcm_dashboard", months: result.months.length },
      });
    }
    return result;
  });

  if (!report) {
    return (
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
        <PageHeader
          title="RCM dashboard"
          description="Revenue, collections, receivables, and denials at a glance."
        />
        <Panel>
          <EmptyState
            title="No activity files yet"
            description="Import a month-end activity file on the Monthly files page to fill the dashboard."
          />
        </Panel>
      </div>
    );
  }

  const { kpis, aging, denials } = report;
  const over90 = aging.totals.buckets["91_120"] + aging.totals.buckets.over_120;
  const openAr = aging.totals.totalCents;
  const trailing = `last ${kpis.trailingMonths} month${kpis.trailingMonths === 1 ? "" : "s"}`;
  const maxRevenue = Math.max(1, ...report.months.map((m) => m.netRevenueCents));
  const clearing = report.reconciliation.at(-1);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader
        title="RCM dashboard"
        description={`${periodLabel(kpis.latest.periodYear, kpis.latest.periodMonth)}, from the month-end activity files and DenialDesk denials. Totals only.`}
      />

      <section aria-label="Key figures" className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Net revenue"
          value={formatCents(kpis.netRevenueCents)}
          detail="Charges less write-offs, last month"
        />
        <StatTile label="Payments" value={formatCents(kpis.paymentsCents)} detail="Posted last month" />
        <StatTile label="Open A/R" value={formatCents(openAr)} detail="At month-end, credits excluded" />
        <StatTile
          label="Days in A/R"
          value={kpis.daysInAr === null ? "—" : kpis.daysInAr.toFixed(1)}
          detail={`Open A/R ÷ average daily net revenue, ${trailing}`}
        />
        <StatTile
          label="Net collection rate"
          value={kpis.netCollectionBps === null ? "—" : percent(kpis.netCollectionBps)}
          detail={`Payments ÷ net revenue, ${trailing}`}
        />
        <StatTile
          label="Over 90 days"
          value={openAr > 0 ? percent(Math.round((over90 * 10_000) / openAr)) : "—"}
          detail={formatCents(over90)}
          emphasis={openAr > 0 && over90 * 4 > openAr ? "warning" : undefined}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          title="Net revenue by month"
          description={`${report.months.length} months with activity files`}
        >
          <BarList
            label="Net revenue by month"
            rows={report.months.map((m) => ({
              key: `${m.periodYear}-${m.periodMonth}`,
              label: `${MONTHS[m.periodMonth - 1]} ${m.periodYear}`,
              value: Math.max(0, m.netRevenueCents),
              display: formatCents(m.netRevenueCents),
            }))}
          />
          <p className="mt-3 text-label text-muted">
            Bars scale to the largest month ({formatCents(maxRevenue)}).
          </p>
        </Panel>

        <Panel title="Payments by month" description="Posted in the practice-management system">
          <BarList
            label="Payments by month"
            tone="chart-4"
            rows={report.months.map((m) => ({
              key: `${m.periodYear}-${m.periodMonth}`,
              label: `${MONTHS[m.periodMonth - 1]} ${m.periodYear}`,
              value: Math.max(0, m.paymentsCents),
              display: formatCents(m.paymentsCents),
            }))}
          />
          {clearing && (
            <p className="mt-3 text-label text-muted">
              {clearing.clearingCents >= 0
                ? `${formatCents(clearing.clearingCents)} posted but not yet deposited.`
                : `${formatCents(-clearing.clearingCents)} deposited but not yet posted.`}{" "}
              <Link href="/revenue-cycle/ar-aging" className="font-medium text-link hover:underline">
                Reconciliation
              </Link>
            </p>
          )}
        </Panel>
      </div>

      <Panel
        title="Open denials by financial class"
        description="Denied dollars still being worked in DenialDesk, matched to classes through each payer's regulatory regime"
        actions={
          <Link href="/denials?status=open" className="text-label font-medium text-link hover:underline">
            Denial queue
          </Link>
        }
        flush
      >
        {denials.count === 0 ? (
          <EmptyState title="No open denials" description="Nothing in the denial queue is still open." />
        ) : (
          <>
            <Table caption="Open denied dollars by financial class">
              <thead>
                <tr>
                  <Th>Class</Th>
                  <Th numeric>Open denials</Th>
                  <Th numeric>Denied</Th>
                </tr>
              </thead>
              <tbody>
                {denials.byClass.map((d) => (
                  <Tr key={d.payerClass}>
                    <Td>
                      {d.payerClass === "Unmapped" ? (
                        <span className="text-muted">No matching class</span>
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
              {formatCents(denials.deniedCents)} in open denials
              {openAr > 0
                ? `, ${percent(Math.round((denials.deniedCents * 10_000) / openAr))} of open A/R. The two come from different sources (denials from remittances, A/R from the monthly file), so treat the share as an indicator.`
                : "."}
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}
