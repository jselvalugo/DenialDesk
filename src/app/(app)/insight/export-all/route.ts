import { NextResponse } from "next/server";
import { canExportInsight } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { parseFilters } from "@/domain/insight/filters";
import { recordReportExported } from "@/domain/insight/queries";
import { buildAllReportsWorkbookFor } from "@/domain/insight/report";
import { getFormat, getT } from "@/i18n/server";
import { isSameOrigin } from "@/lib/same-origin";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function POST(request: Request) {
  const t = await getT("insight");
  if (!isSameOrigin(request)) return new NextResponse(t("error.forbidden"), { status: 403 });
  const auth = await requireAuth();
  if (!canExportInsight(auth.role)) return new NextResponse(t("error.forbidden"), { status: 403 });

  const form = await request.formData();
  const filters = parseFilters({
    dateFrom: form.get("dateFrom")?.toString() ?? null,
    dateTo: form.get("dateTo")?.toString() ?? null,
    payerId: null,
  });
  if (filters.error) return new NextResponse(t(filters.error), { status: 400 });

  const tc = await getT("common");
  const f = await getFormat();
  const { buffer, filename, rowCount } = await withTenant(auth, async (tx) => {
    const result = await buildAllReportsWorkbookFor(
      tx,
      filters,
      { practiceName: auth.tenantName, userId: auth.userId },
      t,
      tc,
      f,
    );
    await recordReportExported(tx, auth, "all", filters, result.rowCount, "/insight/export-all");
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
