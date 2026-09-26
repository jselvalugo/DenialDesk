import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { daysUntil } from "@rules/deadlines";
import { todayIn } from "@rules/calendar";
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
import { DENIAL_STATUSES, regimeLabel } from "@/domain/denial-status";
import { DUE_SOON_DAYS, listDenials, PAGE_SIZE, payerOptions, queueSummary } from "@/domain/denials/queries";
import { audit } from "@/lib/audit";
import { formatCents } from "@/lib/format";
import { filtersToQuery, parseFilters } from "./filters";

export const metadata: Metadata = { title: "Denial queue" };

const categoryOptions = [
  { value: "", label: "All categories" },
  ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
];

export default async function DenialQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const filters = parseFilters(await searchParams);
  const today = todayIn();

  const { rows, total, summary, payers } = await withTenant(auth, async (tx) => {
    const [list, summary, payers] = await Promise.all([
      listDenials(tx, filters, auth.userId),
      queueSummary(tx, today),
      payerOptions(tx),
    ]);
    await audit(tx, {
      action: "denial.queue_viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      // "What" was shown: the denial IDs on this page (IDs only, no PHI) and the filters used.
      metadata: {
        denialIds: list.rows.map((row) => row.id).join(","),
        count: list.rows.length,
        page: filters.page,
        filters: filtersToQuery(filters, { page: 1 }) || "default",
      },
    });
    return { ...list, summary, payers };
  });

  if (total > 0 && filters.page > Math.ceil(total / PAGE_SIZE)) {
    redirect(`/denials${filtersToQuery(filters, { page: Math.ceil(total / PAGE_SIZE) })}`);
  }
  const first = total === 0 ? 0 : (filters.page - 1) * PAGE_SIZE + 1;
  const last = Math.min(filters.page * PAGE_SIZE, total);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader
        title="Denial queue"
        description="Open denials, most urgent appeal deadline first. Work from the top."
      />

      <section aria-label="Open denial totals" className="grid grid-cols-4 gap-4">
        <StatTile label="Open denials" value={summary.open.toLocaleString("en-US")} />
        <StatTile
          label="Amount at risk"
          value={formatCents(summary.atRiskCents)}
          detail="Denied amount on open denials"
        />
        <StatTile
          label={`Due in ${DUE_SOON_DAYS} days`}
          value={summary.dueSoon}
          emphasis={summary.dueSoon > 0 ? "warning" : undefined}
          detail="Appeal deadline this week"
        />
        <StatTile
          label="Past deadline"
          value={summary.overdue}
          emphasis={summary.overdue > 0 ? "danger" : undefined}
          detail={
            summary.noDeadline > 0
              ? `${summary.noDeadline} with no deadline configured`
              : "Open with deadline passed"
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
            label="Payer"
            name="payer"
            defaultValue={filters.payerId ?? ""}
            options={[
              { value: "", label: "All payers" },
              ...payers.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <Select
            label="Category"
            name="category"
            defaultValue={filters.category ?? ""}
            options={categoryOptions}
          />
          <Select
            label="Assignee"
            name="assignee"
            defaultValue={filters.assignee ?? ""}
            options={[
              { value: "", label: "Anyone" },
              { value: "me", label: "Assigned to me" },
              { value: "unassigned", label: "Unassigned" },
            ]}
          />
          <Select
            label="Sort by"
            name="sort"
            defaultValue={filters.sort}
            options={[
              { value: "deadline", label: "Appeal deadline" },
              { value: "amount", label: "Denied amount" },
              { value: "notice", label: "Newest notice" },
            ]}
          />
          <div className="flex gap-2">
            <Button type="submit" size="md">
              Apply
            </Button>
            <Link
              href="/denials"
              className="inline-flex h-8 items-center rounded-control px-3 text-body font-medium text-muted hover:bg-surface-muted hover:text-text"
            >
              Reset
            </Link>
          </div>
        </form>

        {rows.length === 0 ? (
          filtersToQuery(filters, { page: 1 }) === "" && summary.open === 0 ? (
            <EmptyState
              title="No open denials"
              description="Denials are captured from payer remittances (835 ERAs). Choose status “All” to see closed denials."
            />
          ) : (
            <EmptyState
              title="No denials match these filters"
              description="Try a different status or payer, or reset the filters to see every open denial."
            />
          )
        ) : (
          <Table
            caption={`Denials, sorted by ${filters.sort === "deadline" ? "appeal deadline" : filters.sort}`}
          >
            <thead>
              <tr>
                <Th>Claim</Th>
                <Th>Patient</Th>
                <Th>Payer</Th>
                <Th>Reason</Th>
                <Th numeric aria-sort={filters.sort === "amount" ? "descending" : undefined}>
                  Denied
                </Th>
                <Th aria-sort={filters.sort === "deadline" ? "ascending" : undefined}>Appeal deadline</Th>
                <Th>Status</Th>
                <Th>Assignee</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = DENIAL_STATUSES[row.status];
                return (
                  <Tr key={row.id}>
                    <Td>
                      <Link
                        href={`/denials/${row.id}`}
                        className="font-mono text-label font-medium whitespace-nowrap text-link hover:underline"
                      >
                        {row.claimNumber}
                      </Link>
                    </Td>
                    <Td>
                      <span className="block font-medium">
                        {row.patientLast}, {row.patientFirst.charAt(0)}.
                      </span>
                      <span className="block font-mono text-label text-muted">{row.mrn}</span>
                    </Td>
                    <Td>
                      <span className="block">{row.payerName}</span>
                      <span className="block text-label text-muted">{regimeLabel(row.regime)}</span>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-2">
                        <Code>
                          {row.groupCode}-{row.carc}
                        </Code>
                        <span className="text-muted">{CATEGORY_LABELS[row.category]}</span>
                      </span>
                    </Td>
                    <Td numeric className="font-medium">
                      <Money cents={row.deniedCents} />
                    </Td>
                    <Td>
                      {row.appealSubmittedOn ? (
                        row.appealDeadline ? (
                          row.appealSubmittedOn > row.appealDeadline ? (
                            <span className="text-label font-medium text-danger-fg">
                              Filed after deadline
                            </span>
                          ) : (
                            <span className="text-label text-muted">Appeal filed on time</span>
                          )
                        ) : (
                          <span className="text-label text-muted">Appeal filed · no deadline configured</span>
                        )
                      ) : row.appealDeadline ? (
                        status.awaitingAction ? (
                          <DeadlineIndicator
                            dueDate={row.appealDeadline}
                            daysRemaining={daysUntil(row.appealDeadline, today)}
                            dueSoonDays={DUE_SOON_DAYS}
                          />
                        ) : (
                          <span className="text-muted">—</span>
                        )
                      ) : (
                        <span className="text-label font-medium text-warning-fg">Not configured</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </Td>
                    <Td className={row.assigneeName ? "" : "text-subtle"}>
                      {row.assigneeName ?? "Unassigned"}
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
              href={`/denials${filtersToQuery(filters, { page: filters.page - 1 })}`}
            >
              Previous
            </PageLink>
            <span className="tabular">
              Page {filters.page} of {pages}
            </span>
            <PageLink
              disabled={filters.page >= pages}
              href={`/denials${filtersToQuery(filters, { page: filters.page + 1 })}`}
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
