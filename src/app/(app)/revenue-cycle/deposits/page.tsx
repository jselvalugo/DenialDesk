import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canConfigureRevenueCycle, canRunRevenueCycle, canViewRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { listDepositFiles, monthsWithoutDeposits } from "@/domain/revenue-cycle/receivables";
import { rich } from "@/i18n/rich";
import { getFormat, getT } from "@/i18n/server";
import { syntheticDataOnly } from "@/lib/env";
import { DepositUploadForm, ReverseDepositsForm } from "./DepositUploadForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("revenue");
  return { title: t("deposits.title") };
}

export default async function DepositsPage() {
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  const t = await getT("revenue");
  const f = await getFormat();
  const { files, openMonths } = await withTenant(auth, async (tx) => ({
    files: await listDepositFiles(tx),
    openMonths: await monthsWithoutDeposits(tx),
  }));
  const isAdmin = canConfigureRevenueCycle(auth.role);
  const synthetic = syntheticDataOnly();

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader title={t("deposits.title")} description={t("deposits.description")} />

      <Panel
        title={t("deposits.importedTitle")}
        description={t("deposits.importedDescription", { count: files.length })}
        flush
      >
        {files.length === 0 ? (
          <EmptyState title={t("deposits.emptyTitle")} description={t("deposits.emptyDescription")} />
        ) : (
          <Table caption={t("deposits.tableCaption")}>
            <thead>
              <tr>
                <Th>{t("deposits.col.imported")}</Th>
                <Th>{t("deposits.col.depositDates")}</Th>
                <Th numeric>{t("deposits.col.deposits")}</Th>
                <Th numeric>{t("deposits.col.total")}</Th>
                <Th>{t("deposits.col.by")}</Th>
                <Th>{t("deposits.col.status")}</Th>
              </tr>
            </thead>
            <tbody>
              {files.map((row) => (
                <Tr key={row.id}>
                  <Td>{f.dateOf(row.createdAt)}</Td>
                  <Td className="tabular">
                    {row.dateFrom && row.dateTo ? `${f.date(row.dateFrom)}–${f.date(row.dateTo)}` : "—"}
                  </Td>
                  <Td numeric>{f.number(row.rowCount)}</Td>
                  <Td numeric>
                    <Money cents={row.totalCents} />
                  </Td>
                  <Td className="text-muted">{row.uploadedBy ?? "—"}</Td>
                  <Td>
                    {row.reversesFileId ? (
                      <Badge tone="neutral">{t("deposits.status.reversal")}</Badge>
                    ) : row.reversedBy ? (
                      <Badge tone="danger">{t("deposits.status.reversed")}</Badge>
                    ) : isAdmin ? (
                      <ReverseDepositsForm fileId={row.id} />
                    ) : (
                      <Badge tone="success">{t("deposits.status.active")}</Badge>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {canRunRevenueCycle(auth.role) && (
        <Panel title={t("deposits.importTitle")} description={t("deposits.importDescription")}>
          <DepositUploadForm syntheticOnly={synthetic} />
          {synthetic && (
            <p className="mt-4 text-label text-muted">
              {openMonths.length > 0
                ? rich(t("deposits.sampleFilePrompt", { count: openMonths.length }), {
                    a: (chunks) => (
                      <a
                        href="/api/revenue-cycle/sample-deposits"
                        download
                        className="font-medium text-link hover:underline"
                      >
                        {chunks}
                      </a>
                    ),
                  })
                : t("deposits.everyMonthHasDeposits")}
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}
