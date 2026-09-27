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
import {
  AGING_BUCKETS,
  over90Cents,
  over90ShareBps,
  OVER_90_WARNING_SHARE_BPS,
} from "@/domain/revenue-cycle/aging";
import { periodLabel } from "@/domain/revenue-cycle/imports";
import { receivablesReport } from "@/domain/revenue-cycle/receivables";
import { getFormat, getT } from "@/i18n/server";
import { audit } from "@/lib/audit";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("revenue");
  return { title: t("arAging.title") };
}

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
  const t = await getT("revenue");
  const tc = await getT("common");
  const f = await getFormat();
  const { month } = query.parse(await searchParams);
  const chosen = month ? { year: Number(month.slice(0, 4)), month: Number(month.slice(5)) } : undefined;
  const report = await withTenant(auth, async (tx) => {
    const result = await receivablesReport(tx, chosen, t);
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
        <PageHeader title={t("arAging.title")} description={t("arAging.description")} />
        <Panel>
          <EmptyState title={t("arAging.emptyTitle")} description={t("arAging.emptyDescription")} />
        </Panel>
      </div>
    );
  }

  const { aging, selected } = report;
  const label = periodLabel(selected.periodYear, selected.periodMonth, t.locale);
  const over90 = over90Cents(aging.totals.buckets);
  const over90Bps = over90ShareBps(over90, aging.totals.totalCents);
  const credits = aging.credits.reduce((total, c) => total + c.totalCents, 0);
  // The tile is for "this month" (the header says "at the end of {selected month}"), so it must
  // read the reconciliation row for the selected period, not always the most recent one (F6).
  const latestRecon = report.reconciliation.find(
    (r) => r.periodYear === selected.periodYear && r.periodMonth === selected.periodMonth,
  );

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader title={t("arAging.title")} description={t("arAging.pageDescription", { month: label })} />

      <nav aria-label={t("arAging.monthNav")} className="flex flex-wrap gap-2 text-label">
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
              {periodLabel(p.periodYear, p.periodMonth, t.locale)}
            </Link>
          );
        })}
      </nav>

      <section aria-label={t("arAging.summary")} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label={t("arAging.openAr")}
          value={formatCents(aging.totals.totalCents)}
          detail={t("arAging.asOf", { date: f.date(report.asOf) })}
        />
        <StatTile
          label={t("arAging.over90")}
          value={formatCents(over90)}
          detail={
            over90Bps === null
              ? t("arAging.noOpenAr")
              : t("arAging.shareOfOpenAr", { percent: (over90Bps / 100).toFixed(1) })
          }
          emphasis={over90Bps !== null && over90Bps > OVER_90_WARNING_SHARE_BPS ? "warning" : undefined}
        />
        <StatTile
          label={t("arAging.creditBalances")}
          value={formatCents(credits)}
          detail={t("arAging.creditBalancesDetail", {
            count: aging.credits.reduce((total, c) => total + c.lines, 0),
          })}
          emphasis={credits < 0 ? "warning" : undefined}
        />
        <StatTile
          label={
            latestRecon && latestRecon.clearingCents < 0
              ? t("arAging.unpostedDeposits")
              : t("arAging.undepositedPayments")
          }
          value={latestRecon ? formatCents(Math.abs(latestRecon.clearingCents)) : "—"}
          detail={
            latestRecon && latestRecon.clearingCents < 0
              ? t("arAging.depositedNotPosted")
              : t("arAging.postedMinusDeposited")
          }
          emphasis={latestRecon?.alert || (latestRecon?.clearingCents ?? 0) < 0 ? "warning" : undefined}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Panel
          title={t("arAging.byClassTitle")}
          description={t("arAging.openBalancesAt", { date: f.date(report.asOf) })}
          flush
        >
          {aging.rows.length === 0 ? (
            <EmptyState
              title={t("arAging.nothingOpenTitle")}
              description={t("arAging.nothingOpenDescription")}
            />
          ) : (
            <Table caption={t("arAging.byClassTableCaption")}>
              <thead>
                <tr>
                  <Th>{t("arAging.col.class")}</Th>
                  {AGING_BUCKETS.map((b) => (
                    <Th key={b.key} numeric>
                      {t(b.labelKey)}
                    </Th>
                  ))}
                  <Th numeric>{t("arAging.col.total")}</Th>
                </tr>
              </thead>
              <tbody>
                {[...aging.rows, aging.totals].map((row) => (
                  <Tr key={row.payerClass}>
                    <Td className={row === aging.totals ? "font-semibold" : undefined}>
                      {row === aging.totals ? (
                        row.payerClass
                      ) : (
                        <Code>{row.payerClass || t("arAging.blank")}</Code>
                      )}
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
          <Panel title={t("arAging.byAgeTitle")}>
            <BarList
              label={t("arAging.byAgeBarListLabel")}
              rows={AGING_BUCKETS.map((b) => ({
                key: b.key,
                label: t(b.labelKey),
                value: aging.totals.buckets[b.key],
                display: formatCents(aging.totals.buckets[b.key]),
                tone: b.key === "over_120" ? "chart-danger" : b.key === "91_120" ? "chart-4" : undefined,
              }))}
            />
          </Panel>
          <Panel
            title={t("arAging.creditBalancesTitle")}
            description={t("arAging.creditBalancesPanelDescription")}
            flush
          >
            {aging.credits.length === 0 ? (
              <p className="px-4 py-3 text-body text-muted">{t("arAging.noCreditBalances")}</p>
            ) : (
              <Table caption={t("arAging.creditBalancesTableCaption")}>
                <thead>
                  <tr>
                    <Th>{t("arAging.col.class")}</Th>
                    <Th numeric>{t("arAging.col.lines")}</Th>
                    <Th numeric>{t("arAging.col.total")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {aging.credits.map((c) => (
                    <Tr key={c.payerClass}>
                      <Td>
                        <Code>{c.payerClass || t("arAging.blank")}</Code>
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

      <Panel title={t("arAging.rollForwardTitle")} description={t("arAging.rollForwardDescription")} flush>
        <Table caption={t("arAging.rollForwardTableCaption")}>
          <thead>
            <tr>
              <Th>{t("arAging.col.month")}</Th>
              <Th numeric>{t("arAging.col.opening")}</Th>
              <Th numeric>{t("arAging.col.charges")}</Th>
              <Th numeric>{t("arAging.col.payments")}</Th>
              <Th numeric>{t("arAging.col.adjustments")}</Th>
              <Th numeric>{t("arAging.col.closing")}</Th>
              <Th>{t("arAging.col.ties")}</Th>
            </tr>
          </thead>
          <tbody>
            {report.rollForward.map((r) => (
              <Tr key={key(r.periodYear, r.periodMonth)}>
                <Td>{periodLabel(r.periodYear, r.periodMonth, t.locale)}</Td>
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
                    <span className="text-label text-muted">{t("arAging.noPriorMonth")}</span>
                  ) : r.unexplainedCents === 0 ? (
                    <Badge tone="success">{t("arAging.ties")}</Badge>
                  ) : (
                    <Badge tone="danger">
                      {t("arAging.offBy", { amount: formatCents(r.unexplainedCents) })}
                    </Badge>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>

      <Panel
        title={t("arAging.paymentsAndDepositsTitle")}
        description={t("arAging.paymentsAndDepositsDescription")}
        actions={
          <Link href="/revenue-cycle/deposits" className="text-label font-medium text-link hover:underline">
            {t("deposits.title")}
          </Link>
        }
        flush
      >
        <Table caption={t("arAging.paymentsAndDepositsTableCaption")}>
          <thead>
            <tr>
              <Th>{t("arAging.col.month")}</Th>
              <Th numeric>{t("arAging.col.paymentsPosted")}</Th>
              <Th numeric>{t("arAging.col.deposits")}</Th>
              <Th numeric>{t("arAging.col.difference")}</Th>
              <Th numeric>{t("arAging.col.postedMinusDeposited")}</Th>
              <Th>{tc("word.status")}</Th>
            </tr>
          </thead>
          <tbody>
            {report.reconciliation.map((r) => (
              <Tr key={key(r.periodYear, r.periodMonth)}>
                <Td>{periodLabel(r.periodYear, r.periodMonth, t.locale)}</Td>
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
                    <Badge tone="warning">{t("arAging.depositsNotPosted")}</Badge>
                  ) : r.alert ? (
                    <Badge tone="warning">{t("arAging.followUp")}</Badge>
                  ) : r.clearingCents === 0 ? (
                    <Badge tone="success">{t("arAging.cleared")}</Badge>
                  ) : (
                    <span className="text-label text-muted">{t("arAging.inTransit")}</span>
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
