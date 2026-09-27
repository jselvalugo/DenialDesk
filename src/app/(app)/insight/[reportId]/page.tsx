import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canExportInsight, canViewInsight } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { withTenant } from "@/db/tenant";
import { catalogEntry, isAvailableReportId } from "@/domain/insight/catalog";
import { parseFilters } from "@/domain/insight/filters";
import { listPayers, recordReportViewed } from "@/domain/insight/queries";
import { runReport } from "@/domain/insight/report";
import { isSuppressedCell, suppressedLabel } from "@/domain/insight/suppression";
import type { CellValue, ColumnType, SheetSpec } from "@/domain/insight/workbook";
import { formatCents } from "@/lib/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reportId: string }>;
}): Promise<Metadata> {
  const { reportId } = await params;
  return { title: catalogEntry(reportId)?.title ?? "Insight" };
}

function formatCell(type: ColumnType, value: CellValue): string {
  // Small-cell suppression (R-8.7): the typed marker renders its label regardless of the
  // column's declared type — never inferred by comparing rendered text to that label.
  if (isSuppressedCell(value)) return suppressedLabel();
  if (value === null) return "—";
  if (type === "currency") return formatCents(Number(value));
  if (type === "percent") return `${(Number(value) * 100).toFixed(2)}%`;
  return String(value);
}

function ReportTable({ sheet }: { sheet: SheetSpec }) {
  if (sheet.rows.length === 0) {
    return sheet.emptyMessage ? (
      <EmptyState title={sheet.emptyMessage} description="No rows match the current filters." />
    ) : (
      <EmptyState title="No data for this range" description="Try a wider date range or a different payer." />
    );
  }
  return (
    <Table caption={sheet.name}>
      <thead>
        <Tr>
          {sheet.columns.map((c) => (
            <Th key={c.key} numeric={c.type === "currency" || c.type === "percent" || c.type === "number"}>
              {c.header}
            </Th>
          ))}
        </Tr>
      </thead>
      <tbody>
        {sheet.rows.map((row, i) => (
          <Tr key={i}>
            {sheet.columns.map((c) => (
              <Td key={c.key} numeric={c.type === "currency" || c.type === "percent" || c.type === "number"}>
                {formatCell(c.type, row[c.key] ?? null)}
              </Td>
            ))}
          </Tr>
        ))}
        {sheet.totals && (
          <Tr>
            {sheet.columns.map((c) => (
              <Td
                key={c.key}
                numeric={c.type === "currency" || c.type === "percent" || c.type === "number"}
                className="font-semibold"
              >
                {formatCell(c.type, sheet.totals![c.key] ?? null)}
              </Td>
            ))}
          </Tr>
        )}
      </tbody>
    </Table>
  );
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { reportId } = await params;
  if (!isAvailableReportId(reportId)) notFound();
  const entry = catalogEntry(reportId)!;
  const auth = await requireAuth();
  if (!canViewInsight(auth.role)) notFound();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const filters = parseFilters({
    dateFrom: one(sp.dateFrom) ?? null,
    dateTo: one(sp.dateTo) ?? null,
    payerId: entry.payerFilterEnabled ? (one(sp.payerId) ?? null) : null,
  });

  const { sheets, payers } = await withTenant(auth, async (tx) => {
    const payers = await listPayers(tx);
    if (filters.error) return { sheets: [] as SheetSpec[], payers };
    await recordReportViewed(tx, auth, reportId, filters, `/insight/${reportId}`);
    const { sheets } = await runReport(tx, reportId, filters);
    return { sheets, payers };
  });

  const canExport = canExportInsight(auth.role);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={entry.title} description={entry.purpose} />
      <Panel flush>
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="dateFrom" className="text-label font-medium text-text">
              From
            </label>
            <input
              id="dateFrom"
              type="date"
              name="dateFrom"
              defaultValue={filters.dateFrom}
              className="h-9 rounded-control border border-border-strong bg-surface px-3 text-body text-text"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="dateTo" className="text-label font-medium text-text">
              To
            </label>
            <input
              id="dateTo"
              type="date"
              name="dateTo"
              defaultValue={filters.dateTo}
              className="h-9 rounded-control border border-border-strong bg-surface px-3 text-body text-text"
            />
          </div>
          {entry.payerFilterEnabled ? (
            <Select
              label="Payer"
              name="payerId"
              defaultValue={filters.payerId ?? ""}
              options={[
                { value: "", label: "All payers" },
                ...payers.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          ) : (
            <p className="pb-2 text-label text-muted">
              Payer filter is not applicable — this report is the payer breakdown.
            </p>
          )}
          <Button type="submit" variant="primary" size="md">
            Apply
          </Button>
        </form>
        {filters.error ? (
          <div className="px-5 py-4 text-body font-medium text-danger-fg">{filters.error}</div>
        ) : (
          <div className="flex flex-col gap-6 p-5">
            {sheets.map((sheet) => (
              <ReportTable key={sheet.name} sheet={sheet} />
            ))}
          </div>
        )}
      </Panel>
      {canExport && !filters.error && (
        <form method="post" action={`/insight/${reportId}/export`} className="flex justify-end">
          <input type="hidden" name="dateFrom" value={filters.dateFrom} />
          <input type="hidden" name="dateTo" value={filters.dateTo} />
          {filters.payerId && <input type="hidden" name="payerId" value={filters.payerId} />}
          <Button type="submit" variant="primary">
            Download Excel
          </Button>
        </form>
      )}
      {!canExport && (
        <p className="text-right text-label text-muted">
          Exporting this report is limited to admin, manager, and compliance roles.
        </p>
      )}
    </div>
  );
}
