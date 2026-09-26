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
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Statements" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (m: { periodYear: number; periodMonth: number }) =>
  `${MONTHS[m.periodMonth - 1]} ${String(m.periodYear).slice(2)}`;

export default async function StatementsPage() {
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  // The report records the view (R-7.5.1).
  const report = await withTenant(auth, (tx) => statementsReport(tx, auth));

  if (!report) {
    return (
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
        <PageHeader title="Statements" description="Revenue, receivables, and cash by month." />
        <Panel>
          <EmptyState
            title="No activity files yet"
            description="Import a month-end activity file to build the statements."
          />
        </Panel>
      </div>
    );
  }

  const { income } = report;
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
      <PageHeader
        title="Statements"
        description="Revenue as routed by the practice's accounting rules, open receivables by account, and cash by month. From the month-end activity files (the posted voucher's file where one exists)."
      />

      <Panel
        title="Income statement"
        description="Charges by revenue account less adjustments and write-offs by adjustment account. ⚠️ Management view: confirm the presentation with the practice's accountant."
        flush
      >
        <div className="overflow-x-auto">
          <Table caption="Income statement by month">
            <thead>
              <tr>
                <Th>Account</Th>
                {income.months.map((m) => (
                  <Th key={`${m.periodYear}-${m.periodMonth}`} numeric>
                    {short(m)}
                  </Th>
                ))}
                <Th numeric>Total</Th>
              </tr>
            </thead>
            <tbody>
              <Tr>
                <Td className="font-semibold" colSpan={income.months.length + 2}>
                  Revenue
                </Td>
              </Tr>
              {income.revenue.map((row) => accountRow(row, 1))}
              {totalRow("Total revenue", income.grossCents)}
              <Tr>
                <Td className="font-semibold" colSpan={income.months.length + 2}>
                  Less adjustments and write-offs
                </Td>
              </Tr>
              {income.deductions.map((row) => accountRow(row, -1))}
              {totalRow(
                "Total adjustments",
                income.deductionCents.map((c) => -c),
              )}
              {totalRow("Net revenue", income.netCents, true)}
            </tbody>
          </Table>
        </div>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel
          title="Receivables"
          description={`Open balances at ${formatDate(report.asOf)} by receivable account. Credit balances are money that may be owed back.`}
          flush
        >
          <Table caption="Receivables by account">
            <thead>
              <tr>
                <Th>Account</Th>
                <Th numeric>Open</Th>
                <Th numeric>Credit balances</Th>
                <Th numeric>Net</Th>
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
                <Td className="font-semibold">Total</Td>
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
            No allowance for doubtful accounts is estimated; the practice sets its own policy.
          </p>
        </Panel>

        <Panel
          title="Cash"
          description="Payments posted, bank deposits, and undeposited payments by month"
          flush
        >
          <Table caption="Cash by month">
            <thead>
              <tr>
                <Th>Month</Th>
                <Th numeric>Payments posted</Th>
                <Th numeric>Deposits</Th>
                <Th numeric>Undeposited to date</Th>
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
