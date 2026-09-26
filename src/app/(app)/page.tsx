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
import { CATEGORY_LABELS } from "@/domain/carc";
import { DENIAL_STATUSES } from "@/domain/denial-status";
import { DUE_SOON_DAYS, openByCategory, queueSummary, upcomingDeadlines } from "@/domain/denials/queries";
import { audit } from "@/lib/audit";
import { formatCents } from "@/lib/format";

export default async function OverviewPage() {
  const auth = await requireAuth();
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
        title="Overview"
        description="Open denials, money at risk, and the deadlines that need attention first."
        actions={
          <Link
            href="/denials"
            className="inline-flex h-8 items-center rounded-control border border-brand-600 bg-brand-600 px-3 text-body font-medium text-white hover:bg-brand-700"
          >
            Open denial queue
          </Link>
        }
      />

      <section aria-label="Open denial totals" className="grid grid-cols-4 gap-4">
        <StatTile label="Open denials" value={summary.open.toLocaleString("en-US")} />
        <StatTile label="Amount at risk" value={formatCents(summary.atRiskCents)} />
        <StatTile
          label={`Due in ${DUE_SOON_DAYS} days`}
          value={summary.dueSoon}
          emphasis={summary.dueSoon > 0 ? "warning" : undefined}
        />
        <StatTile
          label="Past deadline"
          value={summary.overdue}
          emphasis={summary.overdue > 0 ? "danger" : undefined}
        />
      </section>

      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start gap-6">
        <Panel title="Next appeal deadlines" description="Open denials, soonest first." flush>
          {upcoming.length === 0 ? (
            <EmptyState
              title="No upcoming deadlines"
              description="Open denials with an appeal deadline will appear here, soonest first."
            />
          ) : (
            <Table caption="Next appeal deadlines">
              <thead>
                <tr>
                  <Th>Claim</Th>
                  <Th>Payer</Th>
                  <Th>Category</Th>
                  <Th numeric>Denied</Th>
                  <Th>Deadline</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((row) => (
                  <Tr key={row.id}>
                    <Td>
                      <Link
                        href={`/denials/${row.id}`}
                        className="font-mono text-label font-medium whitespace-nowrap text-brand-600 hover:underline"
                      >
                        {row.claimNumber}
                      </Link>
                    </Td>
                    <Td>{row.payerName}</Td>
                    <Td className="text-muted">{CATEGORY_LABELS[row.category]}</Td>
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
                        {DENIAL_STATUSES[row.status].label}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel title="Open denials by reason" description="Where the money at risk sits." flush>
          {categories.length === 0 ? (
            <EmptyState
              title="No open denials"
              description="Denials appear here once remittances with denials are imported."
            />
          ) : (
            <Table caption="Open denials by reason category">
              <thead>
                <tr>
                  <Th>Category</Th>
                  <Th numeric>Denials</Th>
                  <Th numeric>Denied</Th>
                  <Th numeric>Share</Th>
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
                          className="font-medium text-text hover:text-brand-600 hover:underline"
                        >
                          {CATEGORY_LABELS[row.category]}
                        </Link>
                      </Td>
                      <Td numeric>{row.count}</Td>
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
                              className="block h-full bg-brand-600"
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
