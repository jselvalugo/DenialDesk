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
import { Pagination } from "@/components/ui/Pagination";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { StatTile } from "@/components/ui/StatTile";
import { withTenant } from "@/db/tenant";
import { CATEGORY_LABEL_KEYS, CATEGORY_ORDER } from "@/domain/carc";
import { DENIAL_STATUSES, regimeLabel } from "@/domain/denial-status";
import { DUE_SOON_DAYS, listDenials, PAGE_SIZE, payerOptions, queueSummary } from "@/domain/denials/queries";
import { loadListValues } from "@/domain/custom-fields/list-values";
import { ListCell } from "@/components/custom-fields/ListCell";
import { getFormat, getT } from "@/i18n/server";
import { audit } from "@/lib/audit";
import { formatCents } from "@/lib/format";
import { filtersToQuery, parseFilters } from "./filters";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("denials");
  return { title: t("queue.title") };
}

export default async function DenialQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const filters = parseFilters(await searchParams);
  const today = todayIn();
  const t = await getT("denials");
  const tc = await getT("common");
  const f = await getFormat();
  const categoryOptions = [
    { value: "", label: t("filter.allCategories") },
    ...CATEGORY_ORDER.map((value) => ({ value, label: tc(CATEGORY_LABEL_KEYS[value]) })),
  ];
  const sortLabel =
    filters.sort === "deadline"
      ? t("sortLabel.deadline")
      : filters.sort === "amount"
        ? t("sortLabel.amount")
        : t("sortLabel.notice");

  const { rows, total, summary, payers, listColumns, listValues } = await withTenant(auth, async (tx) => {
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
    const { columns, valuesByRecord } = await loadListValues(
      tx,
      auth,
      "denial",
      list.rows.map((row) => row.id),
    );
    return { ...list, summary, payers, listColumns: columns, listValues: valuesByRecord };
  });

  if (total > 0 && filters.page > Math.ceil(total / PAGE_SIZE)) {
    redirect(`/denials${filtersToQuery(filters, { page: Math.ceil(total / PAGE_SIZE) })}`);
  }

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader title={t("queue.title")} description={t("queue.description")} />

      <section aria-label={t("overview.totalsAriaLabel")} className="grid grid-cols-4 gap-4">
        <StatTile label={t("stat.openDenials")} value={f.number(summary.open)} />
        <StatTile
          label={t("stat.amountAtRisk")}
          value={formatCents(summary.atRiskCents)}
          detail={t("stat.amountAtRiskDetail")}
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
            label={tc("word.payer")}
            name="payer"
            defaultValue={filters.payerId ?? ""}
            options={[
              { value: "", label: t("filter.allPayers") },
              ...payers.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <Select
            label={tc("word.category")}
            name="category"
            defaultValue={filters.category ?? ""}
            options={categoryOptions}
          />
          <Select
            label={t("field.assignee")}
            name="assignee"
            defaultValue={filters.assignee ?? ""}
            options={[
              { value: "", label: t("filter.anyone") },
              { value: "me", label: t("filter.assignedToMe") },
              { value: "unassigned", label: t("assignee.unassigned") },
            ]}
          />
          <Select
            label={t("field.sortBy")}
            name="sort"
            defaultValue={filters.sort}
            options={[
              { value: "deadline", label: t("field.appealDeadline") },
              { value: "amount", label: t("field.deniedAmount") },
              { value: "notice", label: t("sort.newestNotice") },
            ]}
          />
          <div className="flex gap-2">
            <Button type="submit" size="md">
              {tc("action.apply")}
            </Button>
            <Link
              href="/denials"
              className="inline-flex h-8 items-center rounded-control px-3 text-body font-medium text-muted hover:bg-surface-muted hover:text-text"
            >
              {tc("action.reset")}
            </Link>
          </div>
        </form>

        {rows.length === 0 ? (
          filtersToQuery(filters, { page: 1 }) === "" && summary.open === 0 ? (
            <EmptyState
              title={t("queue.emptyDefaultTitle")}
              description={t("queue.emptyDefaultDescription")}
            />
          ) : (
            <EmptyState
              title={t("queue.emptyFilteredTitle")}
              description={t("queue.emptyFilteredDescription")}
            />
          )
        ) : (
          <Table caption={t("queue.tableCaption", { sort: sortLabel })}>
            <thead>
              <tr>
                <Th>{tc("word.claim")}</Th>
                <Th>{tc("word.patient")}</Th>
                <Th>{tc("word.payer")}</Th>
                <Th>{tc("word.reason")}</Th>
                <Th numeric aria-sort={filters.sort === "amount" ? "descending" : undefined}>
                  {t("field.denied")}
                </Th>
                <Th aria-sort={filters.sort === "deadline" ? "ascending" : undefined}>
                  {t("field.appealDeadline")}
                </Th>
                <Th>{tc("word.status")}</Th>
                <Th>{t("field.assignee")}</Th>
                {listColumns.map((col) => (
                  <Th key={col.fieldId}>{col.label}</Th>
                ))}
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
                      <span className="block text-label text-muted">{regimeLabel(row.regime, tc)}</span>
                    </Td>
                    <Td>
                      <span className="inline-flex items-center gap-2">
                        <Code>
                          {row.groupCode}-{row.carc}
                        </Code>
                        <span className="text-muted">{tc(CATEGORY_LABEL_KEYS[row.category])}</span>
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
                              {t("appealFiled.late")}
                            </span>
                          ) : (
                            <span className="text-label text-muted">{t("appealFiled.onTime")}</span>
                          )
                        ) : (
                          <span className="text-label text-muted">{t("appealFiled.noDeadline")}</span>
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
                        <span className="text-label font-medium text-warning-fg">
                          {t("deadlineNotConfigured")}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={status.tone}>{tc(status.labelKey)}</Badge>
                    </Td>
                    <Td className={row.assigneeName ? "" : "text-subtle"}>
                      {row.assigneeName ?? t("assignee.unassigned")}
                    </Td>
                    {listColumns.map((col) => (
                      <Td key={col.fieldId}>
                        <ListCell type={col.type} value={listValues.get(row.id)?.get(col.key)} />
                      </Td>
                    ))}
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
          hrefFor={(page) => `/denials${filtersToQuery(filters, { page })}`}
        />
      </Panel>
    </div>
  );
}
