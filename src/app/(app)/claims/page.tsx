import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { todayIn } from "@rules/calendar";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
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
import {
  CLAIM_SORT_DEFAULT_DIR,
  CLAIMS_PAGE_SIZE,
  claimsOverview,
  UNSUBMITTED_LIMIT,
  type ClaimSortKey,
} from "@/domain/claims/queries";
import { CLAIM_STATUSES, FILING_STATE_LABEL_KEYS, FILING_WARNING_DAYS } from "@/domain/claims/status";
import { regimeLabel } from "@/domain/denial-status";
import { payerOptions } from "@/domain/denials/queries";
import { loadListValues } from "@/domain/custom-fields/list-values";
import { ListCell } from "@/components/custom-fields/ListCell";
import { getFormat, getT } from "@/i18n/server";
import { audit } from "@/lib/audit";
import { claimFiltersToQuery, parseClaimFilters } from "./filters";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("claims");
  return { title: t("list.title") };
}

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const filters = parseClaimFilters(await searchParams);
  const today = todayIn();
  const t = await getT("claims");
  const tc = await getT("common");
  const f = await getFormat();
  /**
   * Props for one sortable column header (P4, docs/specs/record-pages.md). `serviceDate` also shows
   * active when nothing is explicitly sorted and the group isn't `unsubmitted` — that's this group's
   * actual default order (newest service date first), so the header should say so.
   */
  function sortHeader(key: ClaimSortKey) {
    const explicit = filters.sort === key;
    const impliedDefault = key === "serviceDate" && !filters.sort && filters.group !== "unsubmitted";
    const active = explicit || impliedDefault;
    const currentDir = explicit ? (filters.dir ?? CLAIM_SORT_DEFAULT_DIR[key]) : CLAIM_SORT_DEFAULT_DIR[key];
    const nextDir = nextSortDir(active, currentDir, CLAIM_SORT_DEFAULT_DIR[key]);
    return {
      active,
      dir: currentDir,
      href: `/claims${claimFiltersToQuery(filters, { sort: key, dir: nextDir, page: 1 })}`,
      hint: tc("sortable.hint", {
        direction: tc(nextDir === "asc" ? "sortable.ascending" : "sortable.descending"),
      }),
    };
  }
  /** "Filing deadline" has no direction to toggle; clicking it always clears `sort` and returns to
   * the group's own priority order (filing urgency for unsubmitted claims). */
  const filingDeadlineActive = filters.group === "unsubmitted" && !filters.sort;
  const filingDeadlineHref = `/claims${claimFiltersToQuery(filters, { sort: undefined, dir: undefined, page: 1 })}`;

  const { rows, total, truncated, summary, payers, listColumns, listValues } = await withTenant(
    auth,
    async (tx) => {
      const list = await claimsOverview(tx, filters, today);
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
      const { columns, valuesByRecord } = await loadListValues(
        tx,
        auth,
        "claim",
        list.rows.map((row) => row.id),
      );
      return { ...list, payers, listColumns: columns, listValues: valuesByRecord };
    },
  );

  const pages = Math.max(1, Math.ceil(total / CLAIMS_PAGE_SIZE));
  if (total > 0 && filters.page > pages) redirect(`/claims${claimFiltersToQuery(filters, { page: pages })}`);

  const filtered = Boolean(filters.payerId || filters.filing);
  const emptyTitleKey =
    filters.group === "unsubmitted"
      ? filtered
        ? "list.empty.title.unsubmittedFiltered"
        : "list.empty.title.unsubmitted"
      : filters.group === "in_process"
        ? filtered
          ? "list.empty.title.inProcessFiltered"
          : "list.empty.title.inProcess"
        : filtered
          ? "list.empty.title.allFiltered"
          : "list.empty.title.all";
  const captionKey =
    filters.group === "unsubmitted"
      ? "list.table.captionUnsubmitted"
      : filters.group === "in_process"
        ? "list.table.captionInProcess"
        : "list.table.captionAll";

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader title={t("list.title")} description={t("list.description")} />

      <section aria-label={t("list.stat.sectionLabel")} className="grid grid-cols-4 gap-4">
        <StatTile
          label={t("list.stat.unsubmitted")}
          value={f.number(summary.unsubmitted)}
          detail={t("list.stat.unsubmittedDetail")}
        />
        <StatTile label={t("list.stat.unsubmittedBilled")} value={f.cents(summary.unsubmittedCents)} />
        <StatTile
          label={t("list.stat.dueSoon", { days: FILING_WARNING_DAYS })}
          value={summary.dueSoon}
          emphasis={summary.dueSoon > 0 ? "warning" : undefined}
          detail={t("list.stat.dueSoonDetail")}
        />
        <StatTile
          label={t("list.stat.pastDeadline")}
          value={summary.pastDeadline}
          emphasis={summary.pastDeadline > 0 ? "danger" : undefined}
          detail={
            summary.notConfigured > 0 || summary.payerUnverified > 0
              ? [
                  summary.notConfigured > 0
                    ? t("list.stat.notConfiguredDetail", { count: summary.notConfigured })
                    : null,
                  summary.payerUnverified > 0
                    ? t("list.stat.payerUnverifiedDetail", { count: summary.payerUnverified })
                    : null,
                ]
                  .filter(Boolean)
                  .join(", ")
              : t("list.stat.pastDeadlineDetail")
          }
        />
      </section>

      <Panel flush>
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
          {/* Carries the current sort through Apply, so choosing a filter never drops it back to
              the group's default order (P4 review). */}
          {filters.sort && <input type="hidden" name="sort" value={filters.sort} />}
          {filters.sort && filters.dir && filters.dir !== CLAIM_SORT_DEFAULT_DIR[filters.sort] && (
            <input type="hidden" name="dir" value={filters.dir} />
          )}
          <Select
            label={t("list.filter.claims")}
            name="group"
            defaultValue={filters.group}
            options={[
              { value: "unsubmitted", label: t("list.filter.unsubmitted") },
              { value: "in_process", label: t("list.filter.inProcess") },
              { value: "all", label: tc("word.all") },
            ]}
          />
          <Select
            label={tc("word.payer")}
            name="payer"
            defaultValue={filters.payerId ?? ""}
            options={[
              { value: "", label: t("list.filter.allPayers") },
              ...payers.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <Select
            label={t("list.filter.filingDeadline")}
            name="filing"
            defaultValue={filters.filing ?? ""}
            options={[
              { value: "", label: tc("word.any") },
              { value: "due_soon", label: t("list.filter.dueSoon", { days: FILING_WARNING_DAYS }) },
              { value: "past_deadline", label: t(FILING_STATE_LABEL_KEYS.past_deadline) },
              { value: "not_configured", label: t(FILING_STATE_LABEL_KEYS.not_configured) },
              { value: "payer_unverified", label: t(FILING_STATE_LABEL_KEYS.payer_unverified) },
            ]}
          />
          <div className="flex gap-2">
            <Button type="submit" size="md">
              {tc("action.apply")}
            </Button>
            <Link
              href="/claims"
              className="inline-flex h-8 items-center rounded-control px-3 text-body font-medium text-muted hover:bg-surface-muted hover:text-text"
            >
              {tc("action.reset")}
            </Link>
          </div>
        </form>

        {truncated && (
          <p
            role="note"
            className="border-b border-border bg-warning-bg px-4 py-2 text-label text-warning-fg"
          >
            {t("list.truncated", { limit: f.number(UNSUBMITTED_LIMIT) })}
          </p>
        )}

        {rows.length === 0 ? (
          <EmptyState
            title={t(emptyTitleKey)}
            description={
              filters.group === "unsubmitted"
                ? t("list.empty.descriptionUnsubmitted")
                : t("list.empty.descriptionOther")
            }
          />
        ) : (
          <Table caption={t(captionKey)}>
            <thead>
              <tr>
                <SortableHeader label={tc("word.claim")} {...sortHeader("claimNumber")} />
                <SortableHeader label={tc("word.patient")} {...sortHeader("patientName")} />
                <SortableHeader label={tc("word.payer")} {...sortHeader("payer")} />
                <SortableHeader label={t("list.table.dateOfService")} {...sortHeader("serviceDate")} />
                <SortableHeader numeric label={t("detail.field.billed")} {...sortHeader("billed")} />
                <SortableHeader
                  label={t("list.table.filingDeadline")}
                  active={filingDeadlineActive}
                  dir="asc"
                  href={filingDeadlineHref}
                  hint={tc("sortable.hint", { direction: tc("sortable.ascending") })}
                />
                <SortableHeader label={tc("word.status")} {...sortHeader("status")} />
                {listColumns.map((col) => (
                  <Th key={col.fieldId}>{col.label}</Th>
                ))}
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
                      <Link
                        href={`/patients/${row.patientId}`}
                        className="block font-medium text-link hover:underline"
                      >
                        {row.patientLast}, {row.patientFirst.charAt(0)}.
                      </Link>
                      <span className="block font-mono text-label text-muted">{row.mrn}</span>
                    </Td>
                    <Td>
                      <span className="block">{row.payerName}</span>
                      <span className="block text-label text-muted">{regimeLabel(row.regime, tc)}</span>
                    </Td>
                    <Td className="tabular">{f.date(row.serviceDate)}</Td>
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
                      ) : row.filing.state === "payer_unverified" ? (
                        <span className="text-label font-medium text-warning-fg">
                          {t("list.table.noDeadlinePayerUnverified")}
                        </span>
                      ) : (
                        <span className="text-label font-medium text-warning-fg">
                          {t(FILING_STATE_LABEL_KEYS.not_configured)}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={status.tone}>{tc(status.labelKey)}</Badge>
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
          pageSize={CLAIMS_PAGE_SIZE}
          total={total}
          hrefFor={(page) => `/claims${claimFiltersToQuery(filters, { page })}`}
        />
      </Panel>
    </div>
  );
}
