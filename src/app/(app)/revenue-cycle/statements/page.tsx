import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { canViewRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { statementsReport } from "@/domain/revenue-cycle/reporting";
import type { StatementRow } from "@/domain/revenue-cycle/statements";
import { INTL_TAGS, type Locale } from "@/i18n/config";
import { getFormat, getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("revenue");
  return { title: t("statements.title") };
}

export default async function StatementsPage() {
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  const t = await getT("revenue");
  const f = await getFormat();
  // The report records the view (R-7.5.1).
  const report = await withTenant(auth, (tx) => statementsReport(tx, auth, t));

  if (!report) {
    return (
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
        <PageHeader title={t("statements.title")} description={t("statements.description")} />
        <Panel>
          <EmptyState title={t("statements.emptyTitle")} description={t("statements.emptyDescription")} />
        </Panel>
      </div>
    );
  }

  const { income } = report;
  const short = (m: { periodYear: number; periodMonth: number }) => periodLabelShort(m, t.locale);
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  const accountRow = (row: StatementRow, sign: 1 | -1) => (
    <Tr key={`${sign}-${row.account}`}>
      <Td className="pl-8">
        <Code>{row.account}</Code> <span className="text-muted">{row.name}</span>
      </Td>
      {row.byMonth.map((cents, i) => (
        <Td key={i} numeric>
          <Money cents={sign * cents} />
        </Td>
      ))}
      <Td numeric className="font-medium">
        <Money cents={sign * row.totalCents} />
      </Td>
    </Tr>
  );
  const totalRow = (label: string, values: number[], strong = false): ReactNode => (
    <Tr>
      <Td className={strong ? "font-semibold text-primary" : "font-medium"}>{label}</Td>
      {values.map((cents, i) => (
        <Td key={i} numeric className={strong ? "font-semibold" : "font-medium"}>
          <Money cents={cents} />
        </Td>
      ))}
      <Td numeric className={strong ? "font-semibold" : "font-medium"}>
        <Money cents={sum(values)} />
      </Td>
    </Tr>
  );

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader title={t("statements.title")} description={t("statements.pageDescription")} />

      <Panel
        title={t("statements.incomeStatementTitle")}
        description={t("statements.incomeStatementDescription")}
        flush
      >
        <div className="overflow-x-auto">
          <Table caption={t("statements.incomeStatementTableCaption")}>
            <thead>
              <tr>
                <Th>{t("rules.col.account")}</Th>
                {income.months.map((m) => (
                  <Th key={`${m.periodYear}-${m.periodMonth}`} numeric>
                    {short(m)}
                  </Th>
                ))}
                <Th numeric>{t("arAging.col.total")}</Th>
              </tr>
            </thead>
            <tbody>
              <Tr>
                <Td className="font-semibold" colSpan={income.months.length + 2}>
                  {t("statements.revenue")}
                </Td>
              </Tr>
              {income.revenue.map((row) => accountRow(row, 1))}
              {totalRow(t("statements.totalRevenue"), income.grossCents)}
              <Tr>
                <Td className="font-semibold" colSpan={income.months.length + 2}>
                  {t("statements.lessAdjustments")}
                </Td>
              </Tr>
              {income.deductions.map((row) => accountRow(row, -1))}
              {totalRow(
                t("statements.totalAdjustments"),
                income.deductionCents.map((c) => -c),
              )}
              {totalRow(t("statements.netRevenue"), income.netCents, true)}
            </tbody>
          </Table>
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          title={t("statements.receivablesTitle")}
          description={t("statements.receivablesDescription", { date: f.date(report.asOf) })}
          flush
        >
          <Table caption={t("statements.receivablesTableCaption")}>
            <thead>
              <tr>
                <Th>{t("rules.col.account")}</Th>
                <Th numeric>{t("statements.open")}</Th>
                <Th numeric>{t("arAging.creditBalances")}</Th>
                <Th numeric>{t("statements.net")}</Th>
              </tr>
            </thead>
            <tbody>
              {report.receivables.map((r) => (
                <Tr key={r.account}>
                  <Td>
                    <Code>{r.account}</Code> <span className="text-muted">{r.name}</span>
                  </Td>
                  <Td numeric>
                    <Money cents={r.openCents} />
                  </Td>
                  <Td numeric>
                    <Money cents={r.creditCents} />
                  </Td>
                  <Td numeric className="font-medium">
                    <Money cents={r.openCents + r.creditCents} />
                  </Td>
                </Tr>
              ))}
              <Tr>
                <Td className="font-semibold">{t("statements.total")}</Td>
                <Td numeric className="font-semibold">
                  <Money cents={sum(report.receivables.map((r) => r.openCents))} />
                </Td>
                <Td numeric className="font-semibold">
                  <Money cents={sum(report.receivables.map((r) => r.creditCents))} />
                </Td>
                <Td numeric className="font-semibold">
                  <Money cents={sum(report.receivables.map((r) => r.openCents + r.creditCents))} />
                </Td>
              </Tr>
            </tbody>
          </Table>
          <p className="border-t border-border px-4 py-2.5 text-label text-muted">
            {t("statements.noAllowance")}
          </p>
        </Panel>

        <Panel title={t("statements.cashTitle")} description={t("statements.cashDescription")} flush>
          <Table caption={t("statements.cashTableCaption")}>
            <thead>
              <tr>
                <Th>{t("arAging.col.month")}</Th>
                <Th numeric>{t("arAging.col.paymentsPosted")}</Th>
                <Th numeric>{t("arAging.col.deposits")}</Th>
                <Th numeric>{t("statements.undepositedToDate")}</Th>
              </tr>
            </thead>
            <tbody>
              {report.cash.map((r) => (
                <Tr key={`${r.periodYear}-${r.periodMonth}`}>
                  <Td>{short(r)}</Td>
                  <Td numeric>
                    <Money cents={r.paymentsCents} />
                  </Td>
                  <Td numeric>
                    <Money cents={r.depositsCents} />
                  </Td>
                  <Td numeric className="font-medium">
                    <Money cents={r.clearingCents} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      </div>
    </div>
  );
}

const shortFormats = new Map<Locale, Intl.DateTimeFormat>();

/** "Jan 26" for a statement column header, in the given language. */
function periodLabelShort(m: { periodYear: number; periodMonth: number }, locale: Locale): string {
  let format = shortFormats.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(INTL_TAGS[locale], { month: "short", year: "2-digit", timeZone: "UTC" });
    shortFormats.set(locale, format);
  }
  return format.format(new Date(Date.UTC(m.periodYear, m.periodMonth - 1, 1)));
}
