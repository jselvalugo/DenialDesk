import { NextResponse } from "next/server";
import { canExportInsight } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { isAvailableReportId } from "@/domain/insight/catalog";
import { parseFilters } from "@/domain/insight/filters";
import { recordReportExported } from "@/domain/insight/queries";
import { buildSingleReportWorkbook } from "@/domain/insight/report";
import { isSameOrigin } from "@/lib/same-origin";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * POST so filters travel in the body, never the URL (R-7.4.8) — matches the spec's export
 * pattern. Exporting is limited to admin/manager/compliance (owner decision 2026-09-26).
 */
export async function POST(request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  if (!isSameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const { reportId } = await params;
  if (!isAvailableReportId(reportId)) return new NextResponse("Not found", { status: 404 });
  const auth = await requireAuth();
  if (!canExportInsight(auth.role)) return new NextResponse("Forbidden", { status: 403 });

  const form = await request.formData();
  const filters = parseFilters({
    dateFrom: form.get("dateFrom")?.toString() ?? null,
    dateTo: form.get("dateTo")?.toString() ?? null,
    payerId: form.get("payerId")?.toString() ?? null,
  });
  if (filters.error) return new NextResponse(filters.error, { status: 400 });

  const route = `/insight/${reportId}/export`;
  const { buffer, filename, rowCount } = await withTenant(auth, async (tx) => {
    const result = await buildSingleReportWorkbook(tx, reportId, filters, {
      practiceName: auth.tenantName,
      userId: auth.userId,
    });
    await recordReportExported(tx, auth, reportId, filters, result.rowCount, route);
    return result;
  });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buffer.byteLength),
      "X-Row-Count": String(rowCount),
    },
  });
}
