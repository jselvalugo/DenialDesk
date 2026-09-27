import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayIn } from "@rules/calendar";
import { canRunRevenueCycle, canViewRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { rcmSites } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { CURRENT_FORMAT_VERSION, listFiles, periodLabel } from "@/domain/revenue-cycle/imports";
import type { MessageKey } from "@/i18n/messages/types";
import { rich } from "@/i18n/rich";
import { getFormat, getT } from "@/i18n/server";
import { audit } from "@/lib/audit";
import { syntheticDataOnly } from "@/lib/env";
import { Badge } from "@/components/ui/Badge";
import { UploadForm } from "./UploadForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("revenue");
  return { title: t("files.title") };
}

export default async function FilesPage() {
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  const t = await getT("revenue");
  const f = await getFormat();
  const { files, sites } = await withTenant(auth, async (tx) => {
    const files = await listFiles(tx);
    const sites = await tx
      .select({ id: rcmSites.id, code: rcmSites.code, name: rcmSites.name })
      .from(rcmSites)
      .orderBy(rcmSites.code);
    // Each row aggregates a month's lines, which carry patient names: record which files were
    // shown, IDs only (R-7.5.1).
    if (files.length > 0) {
      await audit(tx, {
        action: "rcm.file_list_viewed",
        actorUserId: auth.userId,
        tenantId: auth.tenantId,
        metadata: { fileIds: files.map((f) => f.id).join(","), count: files.length },
      });
    }
    return { files, sites };
  });
  // More than one import for a month usually means a correction; journal vouchers (B3) must use one.
  const perPeriod = new Map<string, number>();
  for (const f of files) {
    const key = `${f.periodYear}-${f.periodMonth}`;
    perPeriod.set(key, (perPeriod.get(key) ?? 0) + 1);
  }
  const [year, month] = todayIn().split("-").map(Number) as [number, number];
  const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const importColumns = [
    "patientName",
    "accountNumber",
    "serviceDate",
    "cpt",
    "description",
    "facility",
    "payerName",
    "payerClass",
    "status",
    "billed",
    "payment",
    "adjustment",
    "balance",
  ] as const;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader title={t("files.title")} description={t("files.description")} />

      <Panel
        title={t("files.importedTitle")}
        description={t("files.importedDescription", { count: files.length })}
        flush
      >
        {files.length === 0 ? (
          <EmptyState title={t("files.emptyTitle")} description={t("files.emptyDescription")} />
        ) : (
          <Table caption={t("files.tableCaption")}>
            <thead>
              <tr>
                <Th>{t("files.col.period")}</Th>
                <Th>{t("files.col.file")}</Th>
                <Th numeric>{t("files.col.lines")}</Th>
                <Th numeric>{t("files.col.charges")}</Th>
                <Th numeric>{t("files.col.adjustments")}</Th>
                <Th numeric>{t("files.col.netRevenue")}</Th>
                <Th numeric>{t("files.col.payments")}</Th>
                <Th numeric>{t("files.col.openBalance")}</Th>
                <Th numeric>{t("files.col.needsReview")}</Th>
                <Th>{t("files.col.importedBy")}</Th>
              </tr>
            </thead>
            <tbody>
              {files.map((row) => (
                <Tr key={row.id}>
                  <Td>
                    <Link
                      href={`/revenue-cycle/files/${row.id}`}
                      className="font-medium text-link hover:underline"
                    >
                      {periodLabel(row.periodYear, row.periodMonth, t.locale)}
                    </Link>
                    {(perPeriod.get(`${row.periodYear}-${row.periodMonth}`) ?? 0) > 1 && (
                      <span className="ml-2">
                        <Badge tone="warning">{t("files.periodDuplicate")}</Badge>
                      </span>
                    )}
                    {row.formatVersion !== CURRENT_FORMAT_VERSION && (
                      <span className="ml-2" title={t("files.earlierLayoutHint")}>
                        <Badge tone="neutral">{t("files.earlierLayout")}</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="max-w-64 truncate text-muted">{row.filename}</Td>
                  <Td numeric>{f.number(row.rowCount)}</Td>
                  <Td numeric>
                    <Money cents={row.billedCents} />
                  </Td>
                  <Td numeric>
                    <Money cents={row.adjustmentCents} />
                  </Td>
                  <Td numeric className="font-medium">
                    <Money cents={row.netCents} />
                  </Td>
                  <Td numeric>
                    <Money cents={row.paymentCents} />
                  </Td>
                  <Td numeric>
                    <Money cents={row.balanceCents} />
                  </Td>
                  <Td numeric>{row.flaggedCount}</Td>
                  <Td className="text-muted">
                    {row.uploadedBy ?? "—"} · {f.dateTime(row.createdAt)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {canRunRevenueCycle(auth.role) && (
        <Panel
          title={t("files.importTitle")}
          description={t("files.importDescription", {
            columns: importColumns.map((c) => t(("import.column." + c) as MessageKey<"revenue">)).join(", "),
          })}
        >
          <UploadForm
            sites={sites}
            defaultYear={previous.year}
            defaultMonth={previous.month}
            syntheticOnly={syntheticDataOnly()}
          />
          {syntheticDataOnly() && (
            <p className="mt-4 text-label text-muted">
              {rich(t("files.sampleFilePrompt"), {
                a: (chunks) => (
                  <a
                    href="/api/revenue-cycle/sample-file"
                    download
                    className="font-medium text-link hover:underline"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}
