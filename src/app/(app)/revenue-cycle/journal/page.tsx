import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canRunRevenueCycle, canViewRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { CURRENT_FORMAT_VERSION, listFiles, periodLabel } from "@/domain/revenue-cycle/imports";
import { listVouchers } from "@/domain/revenue-cycle/vouchers";
import { getFormat, getT } from "@/i18n/server";
import { VoucherStatusBadge } from "./VoucherStatusBadge";
import { PrepareVoucherForm } from "./VoucherForms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("revenue");
  return { title: t("journal.title") };
}

export default async function JournalPage() {
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  const t = await getT("revenue");
  const tc = await getT("common");
  const f = await getFormat();
  const { vouchers, files } = await withTenant(auth, async (tx) => ({
    vouchers: await listVouchers(tx),
    files: await listFiles(tx),
  }));
  const fileOptions = files
    .filter((file) => file.formatVersion === CURRENT_FORMAT_VERSION)
    .map((file) => ({
      value: file.id,
      label: `${periodLabel(file.periodYear, file.periodMonth, t.locale)} · ${t("journal.importedOn", { date: f.dateOf(file.createdAt) })}`,
    }));

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader title={t("journal.title")} description={t("journal.description")} />

      {canRunRevenueCycle(auth.role) && (
        <Panel title={t("journal.prepareTitle")} description={t("journal.prepareDescription")}>
          {fileOptions.length === 0 ? (
            <p className="text-body text-muted">
              {t("journal.importFileFirst.prefix")}{" "}
              <Link href="/revenue-cycle/files" className="font-medium text-link hover:underline">
                {t("journal.importFileFirst.link")}
              </Link>{" "}
              {t("journal.importFileFirst.suffix")}
            </p>
          ) : (
            <PrepareVoucherForm files={fileOptions} />
          )}
        </Panel>
      )}

      <Panel
        title={t("journal.vouchersTitle")}
        description={t("journal.vouchersDescription", { count: vouchers.length })}
        flush
      >
        {vouchers.length === 0 ? (
          <EmptyState title={t("journal.emptyTitle")} description={t("journal.emptyDescription")} />
        ) : (
          <Table caption={t("journal.tableCaption")}>
            <thead>
              <tr>
                <Th>{t("journal.col.voucher")}</Th>
                <Th>{t("journal.col.month")}</Th>
                <Th>{tc("word.status")}</Th>
                <Th numeric>{t("journal.col.totalDebits")}</Th>
                <Th>{t("journal.col.preparedBy")}</Th>
              </tr>
            </thead>
            <tbody>
              {vouchers.map((v) => (
                <Tr key={v.id}>
                  <Td>
                    <Link
                      href={`/revenue-cycle/journal/${v.id}`}
                      className="font-mono text-label font-medium text-link hover:underline"
                    >
                      {v.number}
                    </Link>
                  </Td>
                  <Td>{periodLabel(v.periodYear, v.periodMonth, t.locale)}</Td>
                  <Td>
                    <VoucherStatusBadge status={v.status} />
                  </Td>
                  <Td numeric>
                    <Money cents={v.debitCents} />
                  </Td>
                  <Td className="text-muted">
                    {v.preparedBy ?? "—"} · {f.dateOf(v.createdAt)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
