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
import { METHOD_LABELS, REMITTANCE_STATUSES } from "@/domain/remittances/status";
import { audit } from "@/lib/audit";
import { formatCents, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Remittances" };

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
        title="Remittances"
        description="Payer payments from 835 remittance files. Check that a file balances, then post it to its claims."
        actions={
          canPostRemittances(auth.role) ? (
            <Link href="/remittances/new" className={primaryLinkButtonClass}>
              New remittance
            </Link>
          ) : undefined
        }
      />

      <section aria-label="Remittance totals" className="grid grid-cols-4 gap-4">
        <StatTile
          label="Ready to post"
          value={summary.ready.toLocaleString("en-US")}
          emphasis={summary.ready > 0 ? "warning" : undefined}
          detail="Loaded, not yet applied to claims"
        />
        <StatTile label="Ready to post, paid" value={formatCents(summary.readyCents)} />
        <StatTile label="Posted" value={summary.posted.toLocaleString("en-US")} />
        <StatTile label="Posted, paid" value={formatCents(summary.postedCents)} />
      </section>

      <Panel flush>
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
          <Select
            label="Status"
            name="status"
            defaultValue={filters.status ?? ""}
            options={[
              { value: "", label: "All" },
              { value: "received", label: REMITTANCE_STATUSES.received.label },
              { value: "posted", label: REMITTANCE_STATUSES.posted.label },
              { value: "void", label: REMITTANCE_STATUSES.void.label },
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
          <div className="flex gap-2">
            <Button type="submit" size="md">
              Apply
            </Button>
            <Link href="/remittances" className={linkButtonReset}>
              Reset
            </Link>
          </div>
        </form>

        {rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No remittances match these filters" : "No remittances yet"}
            description="Upload an 835 remittance file from the payer or clearinghouse to see it here."
          />
        ) : (
          <Table caption="Remittances">
            <thead>
              <tr>
                <Th>Trace number</Th>
                <Th>Payer</Th>
                <Th>Method</Th>
                <Th aria-sort="descending">Payment date</Th>
                <Th numeric>Claims</Th>
                <Th numeric>Paid</Th>
                <Th>Status</Th>
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
                    <Td>{METHOD_LABELS[row.method]}</Td>
                    <Td className="tabular">{formatDate(row.paymentDate)}</Td>
                    <Td numeric>{row.claims}</Td>
                    <Td numeric className="font-medium">
                      <Money cents={row.totalPaidCents} />
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
