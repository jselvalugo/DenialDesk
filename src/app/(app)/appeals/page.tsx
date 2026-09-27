import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { todayIn } from "@rules/calendar";
import { daysUntil } from "@rules/deadlines";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { DeadlineIndicator } from "@/components/ui/DeadlineIndicator";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { StatTile } from "@/components/ui/StatTile";
import { withTenant } from "@/db/tenant";
import { CATEGORY_LABELS } from "@/domain/carc";
import { appealQueueSummary, listAppeals, PAGE_SIZE, DUE_SOON_DAYS } from "@/domain/appeals/queries";
import { APPEAL_LEVEL_LABELS, APPEAL_STATUSES } from "@/domain/appeals/status";
import { payerOptions } from "@/domain/denials/queries";
import { audit } from "@/lib/audit";
import { formatCents } from "@/lib/format";
import { appealFiltersToQuery, parseAppealFilters } from "./filters";

export const metadata: Metadata = { title: "Appeals" };

export default async function AppealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const filters = parseAppealFilters(await searchParams);
  const today = todayIn();

  const { rows, total, summary, payers } = await withTenant(auth, async (tx) => {
    const [list, summary, payers] = await Promise.all([
      listAppeals(tx, filters),
      appealQueueSummary(tx, today),
      payerOptions(tx),
    ]);
    await audit(tx, {
      action: "appeal.list_viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      metadata: {
        appealIds: list.rows.map((row) => row.id).join(","),
        count: list.rows.length,
        page: filters.page,
      },
    });
    return { ...list, summary, payers };
  });

  if (total > 0 && filters.page > Math.ceil(total / PAGE_SIZE)) {
    redirect(`/appeals${appealFiltersToQuery(filters, { page: Math.ceil(total / PAGE_SIZE) })}`);
  }
  const first = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1;
  const last = Math.min(filters.page * PAGE_SIZE, total);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader
        title="Appeals"
        description="Open appeals, most urgent deadline first. Start one from a denial's page."
      />

      <section aria-label="Open appeal totals" className="grid grid-cols-4 gap-4">
        <StatTile label="Open appeals" value={summary.open.toLocaleString("en-US")} />
        <StatTile
          label="Amount at stake"
          value={formatCents(summary.atStakeCents)}
          detail="Denied amount on open appeals"
        />
        <StatTile
          label={`Due in ${DUE_SOON_DAYS} days`}
          value={summary.dueSoon}
          emphasis={summary.dueSoon > 0 ? "warning" : undefined}
          detail="Deadline this week, not yet submitted"
        />
        <StatTile
          label="Past deadline"
          value={summary.overdue}
          emphasis={summary.overdue > 0 ? "danger" : undefined}
          detail={
            summary.noDeadline > 0
              ? `${summary.noDeadline} with no deadline configured`
              : "Not yet submitted, deadline passed"
          }
        />
      </section>

      <Panel flush>
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
          <Select
            label="Status"
            name="status"
            defaultValue={filters.status}
            options={[
              { value: "open", label: "Open" },
              { value: "closed", label: "Closed" },
              { value: "all", label: "All" },
            ]}
          />
          <Select
            label="Level"
            name="level"
            defaultValue={filters.level ?? ""}
            options={[
              { value: "", label: "All levels" },
              { value: "first_level", label: APPEAL_LEVEL_LABELS.first_level! },
            ]}
          />
          <Select
            label="Payer"
            name="payer"
            defaultValue={filters.payerId ?? ""}
            options={[
              { value: "", label: "All payers" },
              ...payers.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <Select
            label="Sort by"
            name="sort"
            defaultValue={filters.sort}
            options={[
              { value: "deadline", label: "Deadline" },
              { value: "amount", label: "Denied amount" },
            ]}
          />
          <div className="flex gap-2">
            <Button type="submit" size="md">
              Apply
            </Button>
            <Link
              href="/appeals"
              className="inline-flex h-8 items-center rounded-control px-3 text-body font-medium text-muted hover:bg-surface-muted hover:text-text"
            >
              Reset
            </Link>
          </div>
        </form>

        {rows.length === 0 ? (
          <EmptyState
            title="No appeals match these filters"
            description="Start an appeal from a denial's page (“Start appeal”), or try a different filter."
          />
        ) : (
          <Table caption={`Appeals, sorted by ${filters.sort === "amount" ? "denied amount" : "deadline"}`}>
            <thead>
              <tr>
                <Th>Claim</Th>
                <Th>Level</Th>
                <Th>Payer</Th>
                <Th>Category</Th>
                <Th numeric>Denied</Th>
                <Th>Deadline</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = APPEAL_STATUSES[row.status];
                return (
                  <Tr key={row.id}>
                    <Td>
                      <Link
                        href={`/appeals/${row.id}`}
                        className="font-mono text-label font-medium whitespace-nowrap text-link hover:underline"
                      >
                        {row.claimNumber}
                      </Link>
                    </Td>
                    <Td>{APPEAL_LEVEL_LABELS[row.level] ?? row.level}</Td>
                    <Td>{row.payerName}</Td>
                    <Td>
                      <Code>{CATEGORY_LABELS[row.category]}</Code>
                    </Td>
                    <Td numeric className="font-medium">
                      <Money cents={row.deniedCents} />
                    </Td>
                    <Td>
                      {row.deadline ? (
                        status.awaitingAction ? (
                          <DeadlineIndicator
                            dueDate={row.deadline}
                            daysRemaining={daysUntil(row.deadline, today)}
                            dueSoonDays={DUE_SOON_DAYS}
                          />
                        ) : (
                          <span className="tabular text-muted">{row.deadline}</span>
                        )
                      ) : (
                        <span className="text-label font-medium text-warning-fg">Not configured</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}

        <nav
          aria-label="Pagination"
          className="flex items-center justify-between border-t border-border px-4 py-2.5 text-label text-muted"
        >
          <span className="tabular">
            {total === 0 ? "No results" : `Showing ${first}–${last} of ${total.toLocaleString("en-US")}`}
          </span>
          <span className="flex items-center gap-2">
            <PageLink
              disabled={filters.page <= 1}
              href={`/appeals${appealFiltersToQuery(filters, { page: filters.page - 1 })}`}
            >
              Previous
            </PageLink>
            <span className="tabular">
              Page {filters.page} of {pages}
            </span>
            <PageLink
              disabled={filters.page >= pages}
              href={`/appeals${appealFiltersToQuery(filters, { page: filters.page + 1 })}`}
            >
              Next
            </PageLink>
          </span>
        </nav>
      </Panel>
    </div>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const className = "inline-flex h-7 items-center rounded-control border px-2.5 font-medium";
  if (disabled) {
    return (
      <span aria-disabled="true" className={`${className} border-border text-subtle`}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={`${className} border-border-strong bg-surface text-text hover:bg-surface-muted`}
    >
      {children}
    </Link>
  );
}
