import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { canConfigureRevenueCycle, canRunRevenueCycle, canViewRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { Money } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatTile } from "@/components/ui/StatTile";
import { withTenant } from "@/db/tenant";
import { periodLabel } from "@/domain/revenue-cycle/imports";
import { allPassed, VOUCHER_CHECK_LABEL_KEYS } from "@/domain/revenue-cycle/journal";
import { getVoucher } from "@/domain/revenue-cycle/vouchers";
import { getFormat, getT } from "@/i18n/server";
import { formatCents } from "@/lib/format";
import { VoucherStatusBadge } from "../VoucherStatusBadge";
import { ApproveVoucherForm, ExportVoucherButton, VoidVoucherForm } from "../VoucherForms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("revenue");
  return { title: t("voucher.title") };
}

export default async function VoucherPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  const t = await getT("revenue");
  const f = await getFormat();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await withTenant(auth, (tx) => getVoucher(tx, id, {}, t));
  if (!detail) notFound();
  const { voucher, lines, checks } = detail;
  const passed = allPassed(checks);
  const canRun = canRunRevenueCycle(auth.role);
  const isPreparer = voucher.preparedBy === auth.userId;
  const period = periodLabel(voucher.periodYear, voucher.periodMonth, t.locale);
  const when = (date: Date | null) => (date ? f.dateTime(date) : undefined);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <p className="text-label text-muted">
        <Link href="/revenue-cycle/journal" className="text-link hover:underline">
          {t("journal.title")}
        </Link>{" "}
        / {voucher.number}
      </p>
      <PageHeader
        title={t("voucher.pageTitle", { period })}
        description={t("voucher.pageDescription", {
          number: voucher.number,
          name: detail.preparedByName ?? t("voucher.unknownPerson"),
          date: when(voucher.createdAt) ?? "",
        })}
      />

      <section aria-label={t("voucher.summary")} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label={t("voucher.col.status")} value={<VoucherStatusBadge status={voucher.status} />} />
        <StatTile label={t("voucher.totalDebits")} value={formatCents(voucher.debitCents)} />
        <StatTile label={t("voucher.totalCredits")} value={formatCents(voucher.creditCents)} />
        <StatTile
          label={t("voucher.checksPassed")}
          value={t("voucher.checksPassedValue", {
            passed: checks.filter((c) => c.passed).length,
            total: checks.length,
          })}
          detail={passed ? t("voucher.readyForApproval") : t("voucher.fixFailingChecks")}
          emphasis={passed ? undefined : "danger"}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Panel title={t("voucher.checksTitle")} description={t("voucher.checksDescription")} flush>
          <ul className="divide-y divide-border" aria-label={t("voucher.checksAria")}>
            {checks.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                <Badge tone={c.passed ? "success" : "danger"}>
                  {c.passed ? t("voucher.pass") : t("voucher.fail")}
                </Badge>
                <div>
                  <p className="font-medium text-text">{t(VOUCHER_CHECK_LABEL_KEYS[c.id])}</p>
                  <p className="text-label text-muted">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={t("voucher.workflow")}>
          <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-body">
            <dt className="text-muted">{t("voucher.sourceFile")}</dt>
            <dd>
              <Link href={`/revenue-cycle/files/${voucher.fileId}`} className="text-link hover:underline">
                {t("voucher.activityFile", { period })}
              </Link>
            </dd>
            {voucher.approvedAt && (
              <>
                <dt className="text-muted">{t("voucher.approved")}</dt>
                <dd>
                  {detail.approvedByName ?? t("voucher.unknownPerson")} · {when(voucher.approvedAt)}
                </dd>
              </>
            )}
            {voucher.exportedAt && (
              <>
                <dt className="text-muted">{t("voucher.firstExported")}</dt>
                <dd>
                  {detail.exportedByName ?? t("voucher.unknownPerson")} · {when(voucher.exportedAt)}
                </dd>
              </>
            )}
            {voucher.voidedAt && (
              <>
                <dt className="text-muted">{t("voucher.voided")}</dt>
                <dd>
                  {detail.voidedByName ?? t("voucher.unknownPerson")} · {when(voucher.voidedAt)}
                  <p className="text-label text-muted">{voucher.voidReason}</p>
                </dd>
              </>
            )}
          </dl>
          <div className="flex flex-col items-start gap-4">
            {voucher.status === "draft" &&
              canRun &&
              (isPreparer ? (
                <p className="text-body text-muted">{t("voucher.preparerMustNotApprove")}</p>
              ) : passed ? (
                <ApproveVoucherForm voucherId={voucher.id} />
              ) : (
                <p className="text-body text-muted">{t("voucher.approvalAvailableOncePassing")}</p>
              ))}
            {(voucher.status === "approved" || voucher.status === "exported") && canRun && (
              <ExportVoucherButton
                voucherId={voucher.id}
                label={voucher.status === "approved" ? t("voucher.exportGlFile") : t("voucher.downloadAgain")}
              />
            )}
            {(voucher.status === "approved" || voucher.status === "exported") &&
              canConfigureRevenueCycle(auth.role) && (
                <VoidVoucherForm voucherId={voucher.id} exported={voucher.status === "exported"} />
              )}
            {voucher.status === "superseded" && (
              <p className="text-body text-muted">{t("voucher.replacedBy", { period })}</p>
            )}
          </div>
        </Panel>
      </div>

      <Panel
        title={t("voucher.linesTitle")}
        description={t("voucher.linesDescription", { count: lines.length })}
        flush
      >
        <Table caption={t("voucher.tableCaption")}>
          <thead>
            <tr>
              <Th numeric>#</Th>
              <Th>{t("voucher.col.account")}</Th>
              <Th>{t("file.col.site")}</Th>
              <Th>{t("voucher.col.memo")}</Th>
              <Th numeric>{t("voucher.col.debit")}</Th>
              <Th numeric>{t("voucher.col.credit")}</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <Tr key={l.id}>
                <Td numeric className="text-muted">
                  {l.lineNumber}
                </Td>
                <Td>
                  <Code>{l.account}</Code>
                </Td>
                <Td className="font-mono text-label">{l.siteCode || "—"}</Td>
                <Td className="text-muted">{l.memo}</Td>
                <Td numeric>{l.debitCents ? <Money cents={l.debitCents} /> : null}</Td>
                <Td numeric>{l.creditCents ? <Money cents={l.creditCents} /> : null}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}
