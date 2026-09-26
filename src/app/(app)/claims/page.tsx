import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { todayIn } from "@rules/calendar";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { DeadlineIndicator } from "@/components/ui/DeadlineIndicator";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { StatTile } from "@/components/ui/StatTile";
import { withTenant } from "@/db/tenant";
import { CLAIMS_PAGE_SIZE, filingSummary, listClaims } from "@/domain/claims/queries";
import { CLAIM_STATUSES, FILING_WARNING_DAYS } from "@/domain/claims/status";
import { REGIME_LABELS } from "@/domain/denial-status";
import { payerOptions } from "@/domain/denials/queries";
import { audit } from "@/lib/audit";
import { formatCents, formatDate } from "@/lib/format";
import { claimFiltersToQuery, parseClaimFilters } from "./filters";

export const metadata: Metadata = { title: "Claims" };

const GROUP_LABELS = { unsubmitted: "unsubmitted", in_process: "sent to payer", all: "all" } as const;

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const filters = parseClaimFilters(await searchParams);
  const today = todayIn();

  const { rows, total, truncated, summary, payers } = await withTenant(auth, async (tx) => {
    const list = await listClaims(tx, filters, today);
    const summary = await filingSummary(tx, today);
    const payers = await payerOptions(tx);
    await audit(tx, {
      action: "claim.list_viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      // IDs only, no PHI.
      metadata: {
        claimIds: list.rows.map((row) => row.id).join(","),
        count: list.rows.length,
        page: filters.page,
        filters: claimFiltersToQuery(filters, { page: 1 }) || "default",
      },
    });
    return { ...list, summary, payers };
  });

  const pages = Math.max(1, Math.ceil(total / CLAIMS_PAGE_SIZE));
  if (total > 0 && filters.page > pages) redirect(`/claims${claimFiltersToQuery(filters, { page: pages })}`);
  const first = total === 0 ? 0 : (filters.page - 1) * CLAIMS_PAGE_SIZE + 1;
  const last = Math.min(filters.page * CLAIMS_PAGE_SIZE, total);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader
        title="Claims"
        description="Unsubmitted claims first, the ones closest to losing their filing window at the top."
      />

      <section aria-label="Unsubmitted claim totals" className="grid grid-cols-4 gap-4">
        <StatTile
          label="Unsubmitted"
          value={summary.unsubmitted.toLocaleString("en-US")}
          detail="Draft or rejected by the payer"
        />
        <StatTile label="Unsubmitted billed" value={formatCents(summary.unsubmittedCents)} />
        <StatTile
          label={`Filing due in ${FILING_WARNING_DAYS} days`}
          value={summary.dueSoon}
          emphasis={summary.dueSoon > 0 ? "warning" : undefined}
          detail="Timely-filing window closing"
        />
        <StatTile
          label="Past filing deadline"
          value={summary.pastDeadline}
          emphasis={summary.pastDeadline > 0 ? "danger" : undefined}
          detail={
            summary.notConfigured > 0
              ? `${summary.notConfigured} with no filing rule (payer contract)`
              : "Likely denied as untimely"
          }
        />
      </section>

      <Panel flush>
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
          <Select
            label="Claims"
            name="group"
            defaultValue={filters.group}
            options={[
              { value: "unsubmitted", label: "Unsubmitted" },
              { value: "in_process", label: "Sent to payer" },
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
            label="Filing deadline"
            name="filing"
            defaultValue={filters.filing ?? ""}
            options={[
              { value: "", label: "Any" },
              { value: "due_soon", label: `Due in ${FILING_WARNING_DAYS} days` },
              { value: "past_deadline", label: "Past deadline" },
              { value: "not_configured", label: "Not configured" },
            ]}
          />
          <div className="flex gap-2">
            <Button type="submit" size="md">
              Apply
            </Button>
            <Link
              href="/claims"
              className="inline-flex h-8 items-center rounded-control px-3 text-body font-medium text-muted hover:bg-surface-muted hover:text-text"
            >
              Reset
            </Link>
          </div>
        </form>

        {truncated && (
          <p
            role="note"
            className="border-b border-border bg-warning-bg px-4 py-2 text-label text-warning-fg"
          >
            Showing the oldest unsubmitted claims only. Narrow by payer to see the rest.
          </p>
        )}

        {rows.length === 0 ? (
          <EmptyState
            title={`No ${GROUP_LABELS[filters.group]} claims${filters.payerId || filters.filing ? " match these filters" : ""}`}
            description={
              filters.group === "unsubmitted"
                ? "Draft and rejected claims appear here until the payer accepts them."
                : "Claims appear here once they are created or imported."
            }
          />
        ) : (
          <Table caption={`Claims: ${GROUP_LABELS[filters.group]}`}>
            <thead>
              <tr>
                <Th>Claim</Th>
                <Th>Patient</Th>
                <Th>Payer</Th>
                <Th>Date of service</Th>
                <Th numeric>Billed</Th>
                <Th aria-sort={filters.group === "unsubmitted" ? "ascending" : undefined}>Filing deadline</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = CLAIM_STATUSES[row.status];
                return (
                  <Tr key={row.id}>
                    <Td>
                      <Link
                        href={`/claims/${row.id}`}
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
                      <span className="block text-label text-muted">{REGIME_LABELS[row.regime]}</span>
                    </Td>
                    <Td className="tabular">{formatDate(row.serviceDate)}</Td>
                    <Td numeric className="font-medium">
                      <Money cents={row.billedCents} />
                    </Td>
                    <Td>
                      {!row.filing ? (
                        <span className="text-muted">—</span>
                      ) : row.filing.deadline && row.filing.daysRemaining !== null ? (
                        <DeadlineIndicator
                          dueDate={row.filing.deadline.date}
                          daysRemaining={row.filing.daysRemaining}
                          dueSoonDays={FILING_WARNING_DAYS}
                        />
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
              href={`/claims${claimFiltersToQuery(filters, { page: filters.page - 1 })}`}
            >
              Previous
            </PageLink>
            <span className="tabular">
              Page {filters.page} of {pages}
            </span>
            <PageLink
              disabled={filters.page >= pages}
              href={`/claims${claimFiltersToQuery(filters, { page: filters.page + 1 })}`}
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
