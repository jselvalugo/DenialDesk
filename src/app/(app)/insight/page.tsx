import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canExportInsight, canViewInsight } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { PageHeader } from "@/components/ui/PageHeader";
import { REPORT_CATALOG } from "@/domain/insight/catalog";
import { defaultDateRange } from "@/domain/insight/filters";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("insight");
  return { title: t("meta.listTitle") };
}

export default async function InsightPage() {
  // Every role can view the report list (owner decision 2026-09-26); each report page enforces
  // its own access, and the export button is gated separately.
  const auth = await requireAuth();
  if (!canViewInsight(auth.role)) notFound();
  const t = await getT("insight");
  const tc = await getT("common");
  const { dateFrom, dateTo } = defaultDateRange();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("moduleName")}
        description={t("list.description")}
        actions={
          canExportInsight(auth.role) ? (
            <form method="post" action="/insight/export-all">
              <input type="hidden" name="dateFrom" value={dateFrom} />
              <input type="hidden" name="dateTo" value={dateTo} />
              <Button type="submit" variant="primary">
                {t("list.downloadAll")}
              </Button>
            </form>
          ) : undefined
        }
      />
      <Panel flush>
        <ul className="divide-y divide-border">
          {REPORT_CATALOG.map((report) => (
            <li key={report.id} className="flex items-center justify-between gap-4 px-5 py-4">
              <div className="min-w-0">
                <p className="font-medium text-text">{t(report.titleKey)}</p>
                <p className="text-body text-muted">{t(report.purposeKey)}</p>
              </div>
              {report.available ? (
                <Link
                  href={`/insight/${report.id}`}
                  className="shrink-0 rounded-control border border-border-strong bg-surface px-3 py-1.5 text-body font-medium text-text hover:bg-surface-muted"
                >
                  {t("list.open")}
                </Link>
              ) : (
                <Badge tone="neutral">{tc("word.planned")}</Badge>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
