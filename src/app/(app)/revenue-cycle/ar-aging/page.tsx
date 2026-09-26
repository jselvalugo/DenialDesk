import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { canViewRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { BarList } from "@/components/ui/BarList";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatTile } from "@/components/ui/StatTile";
import { withTenant } from "@/db/tenant";
import { AGING_BUCKETS } from "@/domain/revenue-cycle/aging";
import { periodLabel } from "@/domain/revenue-cycle/imports";
import { receivablesReport } from "@/domain/revenue-cycle/receivables";
import { audit } from "@/lib/audit";
import { cn } from "@/lib/cn";
import { formatCents, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "A/R aging" };

const query = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional()
    .catch(undefined),
});

const key = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

export default async function AgingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  const { month } = query.parse(await searchParams);
  const chosen = month ? { year: Number(month.slice(0, 4)), month: Number(month.slice(5)) } : undefined;
  const report = await withTenant(auth, async (tx) => {
    const result = await receivablesReport(tx, chosen);
    // Totals only, but built from PHI lines: record the view (R-7.5.1).
    if (result) {
      await audit(tx, {
        action: "rcm.report_viewed",
        actorUserId: auth.userId,
        tenantId: auth.tenantId,
        entityType: "rcm_file",
        entityId: result.selected.fileId,
        metadata: { report: "ar_aging" },
      });
    }
    return result;
  });

  if (!report) {
    return (
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
        <PageHeader title="A/R aging" description="Open receivables by financial class and age." />
        <Panel>
          <EmptyState
            title="No activity files yet"
            description="Import a month-end activity file on the Monthly files page to see receivables here."
          />
        </Panel>
      </div>
    );
  }

  const { aging, selected } = report;
  const label = periodLabel(selected.periodYear, selected.periodMonth);
  const over90 = aging.totals.buckets["91_120"] + aging.totals.buckets.over_120;
  const credits = aging.credits.reduce((t, c) => t + c.totalCents, 0);
  const latestRecon = report.reconciliation.at(-1);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader
        title="A/R aging"
        description={`Open receivables at the end of ${label}, by financial class and days since service. From the month's activity file; totals only.`}
      />

      <nav aria-label="Month" className="flex flex-wrap gap-2 text-label">
        {report.periods.map((p) => {
          const current = p.periodYear === selected.periodYear && p.periodMonth === selected.periodMonth;
          return (
            <Link
              key={p.fileId}
              href={`/revenue-cycle/ar-aging?month=${key(p.periodYear, p.periodMonth)}`}
              aria-current={current ? "page" : undefined}
              className={cn(
                "rounded-control border px-2.5 py-1",
                current
                  ? "border-primary bg-primary text-white"
                  : "border-border-strong text-link hover:bg-surface-muted",
              )}
            >
              {periodLabel(p.periodYear, p.periodMonth)}
            </Link>
          );
        })}
      </nav>

      <section aria-label="Receivables summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Open A/R"
          value={formatCents(aging.totals.totalCents)}
          detail={`As of ${formatDate(report.asOf)}`}
        />
        <StatTile
          label="Over 90 days"
          value={formatCents(over90)}
          detail={
            aging.totals.totalCents > 0
              ? `${((over90 / aging.totals.totalCents) * 100).toFixed(1)}% of open A/R`
              : "No open A/R"
          }
          emphasis={
            aging.totals.totalCents > 0 && over90 / aging.totals.totalCents > 0.25 ? "warning" : undefined
          }
        />
        <StatTile
          label="Credit balances"
          value={formatCents(credits)}
          detail={`${aging.credits.reduce((t, c) => t + c.lines, 0)} lines; refunds may be due`}
          emphasis={credits < 0 ? "warning" : undefined}
        />
        <StatTile
          label={latestRecon && latestRecon.clearingCents < 0 ? "Unposted deposits" : "Undeposited payments"}
          value={latestRecon ? formatCents(Math.abs(latestRecon.clearingCents)) : "—"}
          detail={
            latestRecon && latestRecon.clearingCents < 0
              ? "Deposited but not posted in the practice-management system"
              : "Payments posted minus deposits"
          }
          emphasis={latestRecon?.alert || (latestRecon?.clearingCents ?? 0) < 0 ? "warning" : undefined}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Panel
          title="Aging by financial class"
          description={`Open balances at ${formatDate(report.asOf)}`}
          flush
        >
          {aging.rows.length === 0 ? (
            <EmptyState
              title="Nothing open"
              description="Every line in this month's file has a zero or credit balance."
            />
          ) : (
            <Table caption="Open receivables by financial class and age">
              <thead>
                <tr>
                  <Th>Class</Th>
                  {AGING_BUCKETS.map((b) => (
                    <Th key={b.key} numeric>
                      {b.label}
                    </Th>
                  ))}
                  <Th numeric>Total</Th>
                </tr>
              </thead>
              <tbody>
                {[...aging.rows, aging.totals].map((row) => (
                  <Tr key={row.payerClass}>
                    <Td className={row === aging.totals ? "font-semibold" : undefined}>
                      {row === aging.totals ? row.payerClass : <Code>{row.payerClass || "(blank)"}</Code>}
                    </Td>
                    {AGING_BUCKETS.map((b) => (
                      <Td key={b.key} numeric>
                        <Money cents={row.buckets[b.key]} />
                      </Td>
                    ))}
                    <Td numeric className="font-semibold">
                      <Money cents={row.totalCents} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title="Open A/R by age">
            <BarList
              label="Open receivables by age"
              rows={AGING_BUCKETS.map((b) => ({
                key: b.key,
                label: b.label,
                value: aging.totals.buckets[b.key],
                display: formatCents(aging.totals.buckets[b.key]),
                tone: b.key === "over_120" ? "chart-danger" : b.key === "91_120" ? "chart-4" : undefined,
              }))}
            />
          </Panel>
          <Panel
            title="Credit balances"
            description="Negative open balances by class; refund deadlines aren't tracked here"
            flush
          >
            {aging.credits.length === 0 ? (
              <p className="px-4 py-3 text-body text-muted">No credit balances this month.</p>
            ) : (
              <Table caption="Credit balances by financial class">
                <thead>
                  <tr>
                    <Th>Class</Th>
                    <Th numeric>Lines</Th>
                    <Th numeric>Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {aging.credits.map((c) => (
                    <Tr key={c.payerClass}>
                      <Td>
                        <Code>{c.payerClass || "(blank)"}</Code>
                      </Td>
                      <Td numeric>{c.lines}</Td>
                      <Td numeric>
                        <Money cents={c.totalCents} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>
      </div>

      <Panel
        title="Roll-forward"
        description="Each month's open balance explained from the prior month's. A difference usually means the export missed open lines."
        flush
      >
        <Table caption="Receivables roll-forward by month">
          <thead>
            <tr>
              <Th>Month</Th>
              <Th numeric>Opening</Th>
              <Th numeric>Charges</Th>
              <Th numeric>Payments</Th>
              <Th numeric>Adjustments</Th>
              <Th numeric>Closing</Th>
              <Th>Ties</Th>
            </tr>
          </thead>
          <tbody>
            {report.rollForward.map((r) => (
              <Tr key={key(r.periodYear, r.periodMonth)}>
                <Td>{periodLabel(r.periodYear, r.periodMonth)}</Td>
                <Td numeric>{r.openingCents === null ? "—" : <Money cents={r.openingCents} />}</Td>
                <Td numeric>
                  <Money cents={r.chargesCents} />
                </Td>
                <Td numeric>
                  <Money cents={r.paymentsCents} />
                </Td>
                <Td numeric>
                  <Money cents={r.adjustmentsCents} />
                </Td>
                <Td numeric className="font-medium">
                  <Money cents={r.balanceCents} />
                </Td>
                <Td>
                  {r.unexplainedCents === null ? (
                    <span className="text-label text-muted">No prior month</span>
                  ) : r.unexplainedCents === 0 ? (
                    <Badge tone="success">Ties</Badge>
                  ) : (
                    <Badge tone="danger">Off by {formatCents(r.unexplainedCents)}</Badge>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Panel
        title="Payments and deposits"
        description="Payments posted in the practice-management system against bank deposits in the same month. The running difference (since the first month shown, restarting after a missing month) is what the payments-clearing account should hold."
        actions={
          <Link href="/revenue-cycle/deposits" className="text-label font-medium text-link hover:underline">
            Deposits
          </Link>
        }
        flush
      >
        <Table caption="Payments and deposits by month">
          <thead>
            <tr>
              <Th>Month</Th>
              <Th numeric>Payments posted</Th>
              <Th numeric>Deposits</Th>
              <Th numeric>Difference</Th>
              <Th numeric>Posted minus deposited</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {report.reconciliation.map((r) => (
              <Tr key={key(r.periodYear, r.periodMonth)}>
                <Td>{periodLabel(r.periodYear, r.periodMonth)}</Td>
                <Td numeric>
                  <Money cents={r.paymentsCents} />
                </Td>
                <Td numeric>
                  <Money cents={r.depositsCents} />
                </Td>
                <Td numeric>
                  <Money cents={r.differenceCents} />
                </Td>
                <Td numeric className="font-medium">
                  <Money cents={r.clearingCents} />
                </Td>
                <Td>
                  {r.clearingCents < 0 ? (
                    <Badge tone="warning">Deposits not posted</Badge>
                  ) : r.alert ? (
                    <Badge tone="warning">Follow up</Badge>
                  ) : r.clearingCents === 0 ? (
                    <Badge tone="success">Cleared</Badge>
                  ) : (
                    <span className="text-label text-muted">In transit</span>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}
