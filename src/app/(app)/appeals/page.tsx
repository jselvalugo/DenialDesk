import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { todayIn } from "@rules/calendar";
import { daysUntil } from "@rules/deadlines";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Code } from "@/components/ui/Code";
import { nextSortDir, SortableHeader, Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { DeadlineIndicator } from "@/components/ui/DeadlineIndicator";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { Pagination } from "@/components/ui/Pagination";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { StatTile } from "@/components/ui/StatTile";
import { withTenant } from "@/db/tenant";
import { CATEGORY_LABEL_KEYS } from "@/domain/carc";
import {
  APPEAL_SORT_DEFAULT_DIR,
  appealQueueSummary,
  listAppeals,
  PAGE_SIZE,
  DUE_SOON_DAYS,
  type AppealSortKey,
} from "@/domain/appeals/queries";
import { APPEAL_LEVEL_LABEL_KEYS, APPEAL_STATUSES } from "@/domain/appeals/status";
import { payerOptions } from "@/domain/denials/queries";
import { getFormat, getT } from "@/i18n/server";
import { audit } from "@/lib/audit";
import { formatCents } from "@/lib/format";
import { appealFiltersToQuery, parseAppealFilters } from "./filters";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("appeals");
  return { title: t("queue.title") };
}

export default async function AppealsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const filters = parseAppealFilters(await searchParams);
  const today = todayIn();
  const t = await getT("appeals");
  const tc = await getT("common");
  const f = await getFormat();
  const sortLabel = filters.sort === "amount" ? t("sortLabel.amount") : t("sortLabel.deadline");
  const dir = filters.dir ?? APPEAL_SORT_DEFAULT_DIR[filters.sort];
  /** Props for one sortable column header (P4, docs/specs/record-pages.md). */
  function sortHeader(key: AppealSortKey, label: string) {
    const active = filters.sort === key;
    const nextDir = nextSortDir(active, dir, APPEAL_SORT_DEFAULT_DIR[key]);
    return {
      active,
      dir,
      href: `/appeals${appealFiltersToQuery(filters, { sort: key, dir: nextDir, page: 1 })}`,
      accessibleLabel: tc("sortable.ariaLabel", {
        column: label,
        direction: tc(nextDir === "asc" ? "sortable.ascending" : "sortable.descending"),
      }),
    };
  }

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

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader title={t("queue.title")} description={t("queue.description")} />

      <section aria-label={t("queue.totalsAriaLabel")} className="grid grid-cols-4 gap-4">
        <StatTile label={t("stat.openAppeals")} value={f.number(summary.open)} />
        <StatTile
          label={t("stat.amountAtStake")}
          value={formatCents(summary.atStakeCents)}
          detail={t("stat.amountAtStakeDetail")}
        />
        <StatTile
          label={t("stat.dueInDays", { count: DUE_SOON_DAYS })}
          value={f.number(summary.dueSoon)}
          emphasis={summary.dueSoon > 0 ? "warning" : undefined}
          detail={t("stat.dueSoonDetail")}
        />
        <StatTile
          label={t("stat.pastDeadline")}
          value={f.number(summary.overdue)}
          emphasis={summary.overdue > 0 ? "danger" : undefined}
          detail={
            summary.noDeadline > 0
              ? t("stat.pastDeadlineDetailNoDeadline", { count: summary.noDeadline })
              : t("stat.pastDeadlineDetailDefault")
          }
        />
      </section>

      <Panel flush>
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
          <Select
            label={tc("word.status")}
            name="status"
            defaultValue={filters.status}
            options={[
              { value: "open", label: t("filter.statusOpen") },
              { value: "closed", label: t("filter.statusClosed") },
              { value: "all", label: tc("word.all") },
            ]}
          />
          <Select
            label={t("field.level")}
            name="level"
            defaultValue={filters.level ?? ""}
            options={[
              { value: "", label: t("filter.allLevels") },
              { value: "first_level", label: t(APPEAL_LEVEL_LABEL_KEYS.first_level) },
            ]}
          />
          <Select
            label={tc("word.payer")}
            name="payer"
            defaultValue={filters.payerId ?? ""}
            options={[
              { value: "", label: t("filter.allPayers") },
              ...payers.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <div className="flex gap-2">
            <Button type="submit" size="md">
              {tc("action.apply")}
            </Button>
            <Link
              href="/appeals"
              className="inline-flex h-8 items-center rounded-control px-3 text-body font-medium text-muted hover:bg-surface-muted hover:text-text"
            >
              {tc("action.reset")}
            </Link>
          </div>
        </form>

        {rows.length === 0 ? (
          <EmptyState title={t("empty.title")} description={t("empty.description")} />
        ) : (
          <Table caption={t("queue.tableCaption", { sort: sortLabel })}>
            <thead>
              <tr>
                <Th>{tc("word.claim")}</Th>
                <Th>{t("field.level")}</Th>
                <Th>{tc("word.payer")}</Th>
                <Th>{tc("word.category")}</Th>
                <SortableHeader
                  numeric
                  label={t("field.denied")}
                  {...sortHeader("amount", t("field.denied"))}
                />
                <SortableHeader
                  label={tc("word.deadline")}
                  {...sortHeader("deadline", tc("word.deadline"))}
                />
                <Th>{tc("word.status")}</Th>
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
                    <Td>{t(APPEAL_LEVEL_LABEL_KEYS[row.level])}</Td>
                    <Td>{row.payerName}</Td>
                    <Td>
                      <Code>{tc(CATEGORY_LABEL_KEYS[row.category])}</Code>
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
                          <span className="tabular text-muted">{f.date(row.deadline)}</span>
                        )
                      ) : (
                        <span className="text-label font-medium text-warning-fg">
                          {t("deadlineNotConfigured")}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={status.tone}>{t(status.labelKey)}</Badge>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}

        <Pagination
          page={filters.page}
          pageSize={PAGE_SIZE}
          total={total}
          hrefFor={(page) => `/appeals${appealFiltersToQuery(filters, { page })}`}
        />
      </Panel>
    </div>
  );
}
