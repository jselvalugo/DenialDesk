import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canPostRemittances } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { linkButtonReset, primaryLinkButtonClass } from "@/components/ui/linkButton";
import { Money } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { pageCount, Pagination } from "@/components/ui/Pagination";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { StatTile } from "@/components/ui/StatTile";
import { withTenant } from "@/db/tenant";
import { payerOptions } from "@/domain/denials/queries";
import { REMITTANCES_PAGE_SIZE, remittanceList, type RemittanceFilters } from "@/domain/remittances/queries";
import { METHOD_LABEL_KEYS, REMITTANCE_STATUSES } from "@/domain/remittances/status";
import { getFormat, getT } from "@/i18n/server";
import { audit } from "@/lib/audit";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("remittances");
  return { title: t("list.title") };
}

const schema = z.object({
  status: z.enum(["received", "posted", "void"]).optional().catch(undefined),
  payer: z.uuid().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

function parseFilters(params: Record<string, string | string[] | undefined>): RemittanceFilters {
  const flat = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined]),
  );
  const parsed = schema.parse(flat);
  return { status: parsed.status, payerId: parsed.payer, page: parsed.page };
}

function toQuery(filters: RemittanceFilters, page = filters.page): string {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.payerId) query.set("payer", filters.payerId);
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `?${text}` : "";
}

export default async function RemittancesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const filters = parseFilters(await searchParams);
  const t = await getT("remittances");
  const tc = await getT("common");
  const f = await getFormat();

  const { rows, total, summary, payers } = await withTenant(auth, async (tx) => {
    const list = await remittanceList(tx, filters);
    const payers = await payerOptions(tx);
    await audit(tx, {
      action: "remittance.list_viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      metadata: {
        remittanceIds: list.rows.map((row) => row.id).join(","),
        count: list.rows.length,
        page: filters.page,
      },
    });
    return { ...list, payers };
  });

  const pages = pageCount(total, REMITTANCES_PAGE_SIZE);
  if (total > 0 && filters.page > pages) redirect(`/remittances${toQuery(filters, pages)}`);
  const filtered = Boolean(filters.status || filters.payerId);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader
        title={t("list.title")}
        description={t("list.description")}
        actions={
          canPostRemittances(auth.role) ? (
            <Link href="/remittances/new" className={primaryLinkButtonClass}>
              {t("list.newRemittance")}
            </Link>
          ) : undefined
        }
      />

      <section aria-label={t("list.stat.sectionLabel")} className="grid grid-cols-4 gap-4">
        <StatTile
          label={t("list.stat.readyToPost")}
          value={f.number(summary.ready)}
          emphasis={summary.ready > 0 ? "warning" : undefined}
          detail={t("list.stat.readyDetail")}
        />
        <StatTile label={t("list.stat.readyPaid")} value={f.cents(summary.readyCents)} />
        <StatTile label={t("list.stat.posted")} value={f.number(summary.posted)} />
        <StatTile label={t("list.stat.postedPaid")} value={f.cents(summary.postedCents)} />
      </section>

      <Panel flush>
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
          <Select
            label={tc("word.status")}
            name="status"
            defaultValue={filters.status ?? ""}
            options={[
              { value: "", label: tc("word.all") },
              { value: "received", label: t(REMITTANCE_STATUSES.received.labelKey) },
              { value: "posted", label: t(REMITTANCE_STATUSES.posted.labelKey) },
              { value: "void", label: t(REMITTANCE_STATUSES.void.labelKey) },
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
          <div className="flex gap-2">
            <Button type="submit" size="md">
              {tc("action.apply")}
            </Button>
            <Link href="/remittances" className={linkButtonReset}>
              {tc("action.reset")}
            </Link>
          </div>
        </form>

        {rows.length === 0 ? (
          <EmptyState
            title={filtered ? t("list.empty.titleFiltered") : t("list.empty.title")}
            description={t("list.empty.description")}
          />
        ) : (
          <Table caption={t("list.title")}>
            <thead>
              <tr>
                <Th>{t("list.table.traceNumber")}</Th>
                <Th>{tc("word.payer")}</Th>
                <Th>{t("list.table.method")}</Th>
                <Th aria-sort="descending">{t("list.table.paymentDate")}</Th>
                <Th numeric>{t("list.table.claims")}</Th>
                <Th numeric>{t("list.table.paid")}</Th>
                <Th>{tc("word.status")}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = REMITTANCE_STATUSES[row.status];
                return (
                  <Tr key={row.id}>
                    <Td>
                      <Link
                        href={`/remittances/${row.id}`}
                        className="font-mono text-label font-medium whitespace-nowrap text-link hover:underline"
                      >
                        {row.traceNumber}
                      </Link>
                    </Td>
                    <Td>{row.payerName}</Td>
                    <Td>{t(METHOD_LABEL_KEYS[row.method])}</Td>
                    <Td className="tabular">{f.date(row.paymentDate)}</Td>
                    <Td numeric>{row.claims}</Td>
                    <Td numeric className="font-medium">
                      <Money cents={row.totalPaidCents} />
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
          pageSize={REMITTANCES_PAGE_SIZE}
          total={total}
          hrefFor={(page) => `/remittances${toQuery(filters, page)}`}
        />
      </Panel>
    </div>
  );
}
