import type { Metadata } from "next";
import Link from "next/link";
import { todayIn } from "@rules/calendar";
import { daysUntil } from "@rules/deadlines";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { DeadlineIndicator } from "@/components/ui/DeadlineIndicator";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatTile } from "@/components/ui/StatTile";
import { withTenant } from "@/db/tenant";
import { CATEGORY_LABEL_KEYS } from "@/domain/carc";
import { DENIAL_STATUSES } from "@/domain/denial-status";
import { DUE_SOON_DAYS, openByCategory, queueSummary, upcomingDeadlines } from "@/domain/denials/queries";
import { getFormat, getT } from "@/i18n/server";
import { audit } from "@/lib/audit";
import { formatCents } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("denials");
  return { title: t("overview.title") };
}

export default async function OverviewPage() {
  const auth = await requireAuth();
  const t = await getT("denials");
  const tc = await getT("common");
  const f = await getFormat();
  const today = todayIn();
  const { summary, upcoming, categories } = await withTenant(auth, async (tx) => {
    const [summary, upcoming, categories] = await Promise.all([
      queueSummary(tx, today),
      upcomingDeadlines(tx, today, 8),
      openByCategory(tx),
    ]);
    await audit(tx, {
      action: "denial.queue_viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      metadata: { count: upcoming.length },
    });
    return { summary, upcoming, categories };
  });
  const totalOpenCents = categories.reduce((sum, c) => sum + c.deniedCents, 0);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader
        title={t("overview.title")}
        description={t("overview.description")}
        actions={
          <Link
            href="/denials"
            className="inline-flex h-8 items-center rounded-control border border-primary bg-primary px-3 text-body font-medium text-white hover:bg-primary-hover"
          >
            {t("overview.openQueueLink")}
          </Link>
        }
      />

      <section aria-label={t("overview.totalsAriaLabel")} className="grid grid-cols-4 gap-4">
        <StatTile label={t("stat.openDenials")} value={f.number(summary.open)} />
        <StatTile label={t("stat.amountAtRisk")} value={formatCents(summary.atRiskCents)} />
        <StatTile
          label={t("stat.dueInDays", { count: DUE_SOON_DAYS })}
          value={f.number(summary.dueSoon)}
          emphasis={summary.dueSoon > 0 ? "warning" : undefined}
        />
        <StatTile
          label={t("stat.pastDeadline")}
          value={f.number(summary.overdue)}
          emphasis={summary.overdue > 0 ? "danger" : undefined}
        />
      </section>

      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start gap-6">
        <Panel title={t("overview.deadlines.title")} description={t("overview.deadlines.description")} flush>
          {upcoming.length === 0 ? (
            <EmptyState
              title={t("overview.deadlines.emptyTitle")}
              description={t("overview.deadlines.emptyDescription")}
            />
          ) : (
            <Table caption={t("overview.deadlines.title")}>
              <thead>
                <tr>
                  <Th>{tc("word.claim")}</Th>
                  <Th>{tc("word.payer")}</Th>
                  <Th>{tc("word.category")}</Th>
                  <Th numeric>{t("field.denied")}</Th>
                  <Th>{tc("word.deadline")}</Th>
                  <Th>{tc("word.status")}</Th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((row) => (
                  <Tr key={row.id}>
                    <Td>
                      <Link
                        href={`/denials/${row.id}`}
                        className="font-mono text-label font-medium whitespace-nowrap text-link hover:underline"
                      >
                        {row.claimNumber}
                      </Link>
                    </Td>
                    <Td>{row.payerName}</Td>
                    <Td className="text-muted">{tc(CATEGORY_LABEL_KEYS[row.category])}</Td>
                    <Td numeric>
                      <Money cents={row.deniedCents} />
                    </Td>
                    <Td>
                      {row.appealDeadline && (
                        <DeadlineIndicator
                          dueDate={row.appealDeadline}
                          daysRemaining={daysUntil(row.appealDeadline, today)}
                          dueSoonDays={DUE_SOON_DAYS}
                        />
                      )}
                    </Td>
                    <Td>
                      <Badge tone={DENIAL_STATUSES[row.status].tone}>
                        {tc(DENIAL_STATUSES[row.status].labelKey)}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel title={t("overview.byReason.title")} description={t("overview.byReason.description")} flush>
          {categories.length === 0 ? (
            <EmptyState
              title={t("queue.emptyDefaultTitle")}
              description={t("overview.byReason.emptyDescription")}
            />
          ) : (
            <Table caption={t("overview.byReason.tableCaption")}>
              <thead>
                <tr>
                  <Th>{tc("word.category")}</Th>
                  <Th numeric>{t("field.count")}</Th>
                  <Th numeric>{t("field.denied")}</Th>
                  <Th numeric>{t("field.share")}</Th>
                </tr>
              </thead>
              <tbody>
                {categories.map((row) => {
                  const share = totalOpenCents === 0 ? 0 : row.deniedCents / totalOpenCents;
                  return (
                    <Tr key={row.category}>
                      <Td>
                        <Link
                          href={`/denials?category=${row.category}`}
                          className="font-medium text-text hover:text-link hover:underline"
                        >
                          {tc(CATEGORY_LABEL_KEYS[row.category])}
                        </Link>
                      </Td>
                      <Td numeric>{f.number(row.count)}</Td>
                      <Td numeric>
                        <Money cents={row.deniedCents} />
                      </Td>
                      <Td numeric>
                        <span className="inline-flex items-center justify-end gap-2">
                          <span
                            aria-hidden
                            className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-muted"
                          >
                            <span
                              className="block h-full bg-chart-1"
                              style={{ width: `${Math.round(share * 100)}%` }}
                            />
                          </span>
                          <span className="w-9 text-right">{Math.round(share * 100)}%</span>
                        </span>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>
    </div>
  );
}
