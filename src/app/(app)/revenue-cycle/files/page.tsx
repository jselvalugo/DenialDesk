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
import { syntheticDataOnly } from "@/lib/env";
import { Badge } from "@/components/ui/Badge";
import { UploadForm } from "./UploadForm";

export const metadata: Metadata = { title: "Monthly files" };

export default async function FilesPage() {
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  const { files, sites } = await withTenant(auth, async (tx) => ({
    files: await listFiles(tx),
    sites: await tx
      .select({ id: rcmSites.id, code: rcmSites.code, name: rcmSites.name })
      .from(rcmSites)
      .orderBy(rcmSites.code),
  }));
  // More than one import for a month usually means a correction; journal vouchers (B3) must use one.
  const perPeriod = new Map<string, number>();
  for (const f of files) {
    const key = `${f.periodYear}-${f.periodMonth}`;
    perPeriod.set(key, (perPeriod.get(key) ?? 0) + 1);
  }
  const [year, month] = todayIn().split("-").map(Number) as [number, number];
  const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader
        title="Monthly files"
        description="Each month's charges, payments, adjustments, and open balances from the practice-management system, classified line by line with the practice's accounting rules."
      />

      <Panel title="Imported files" description={`${files.length} files, newest period first`} flush>
        {files.length === 0 ? (
          <EmptyState
            title="No files imported yet"
            description="Import last month's practice-management export below to classify it and prepare the journal voucher."
          />
        ) : (
          <Table caption="Imported monthly files">
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>File</Th>
                <Th numeric>Lines</Th>
                <Th numeric>Charges</Th>
                <Th numeric>Adjustments</Th>
                <Th numeric>Net revenue</Th>
                <Th numeric>Payments</Th>
                <Th numeric>Open balance</Th>
                <Th numeric>Needs review</Th>
                <Th>Imported by</Th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <Tr key={f.id}>
                  <Td>
                    <Link
                      href={`/revenue-cycle/files/${f.id}`}
                      className="font-medium text-link hover:underline"
                    >
                      {periodLabel(f.periodYear, f.periodMonth)}
                    </Link>
                    {(perPeriod.get(`${f.periodYear}-${f.periodMonth}`) ?? 0) > 1 && (
                      <span className="ml-2">
                        <Badge tone="warning">Period imported more than once</Badge>
                      </span>
                    )}
                    {f.formatVersion !== CURRENT_FORMAT_VERSION && (
                      <span
                        className="ml-2"
                        title="Imported before the month-end activity layout; not used for vouchers or aging. Import the month again."
                      >
                        <Badge tone="neutral">Earlier layout</Badge>
                      </span>
                    )}
                  </Td>
                  <Td className="max-w-64 truncate text-muted">{f.filename}</Td>
                  <Td numeric>{f.rowCount.toLocaleString("en-US")}</Td>
                  <Td numeric>
                    <Money cents={f.billedCents} />
                  </Td>
                  <Td numeric>
                    <Money cents={f.adjustmentCents} />
                  </Td>
                  <Td numeric className="font-medium">
                    <Money cents={f.netCents} />
                  </Td>
                  <Td numeric>
                    <Money cents={f.paymentCents} />
                  </Td>
                  <Td numeric>
                    <Money cents={f.balanceCents} />
                  </Td>
                  <Td numeric>{f.flaggedCount}</Td>
                  <Td className="text-muted">
                    {f.uploadedBy ?? "—"} ·{" "}
                    {f.createdAt.toLocaleDateString("en-US", { timeZone: "America/New_York" })}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {canRunRevenueCycle(auth.role) && (
        <Panel
          title="Import a monthly file"
          description="Month-end activity CSV: every charge line with activity in the month or still open at month-end. Columns: Patient name, Account number, Service date, Procedure code, Description, Facility, Payer, Financial class, Status, Charges, Payments, Adjustments (posted in the month), and Balance (open at month-end)."
        >
          <UploadForm
            sites={sites}
            defaultYear={previous.year}
            defaultMonth={previous.month}
            syntheticOnly={syntheticDataOnly()}
          />
          {syntheticDataOnly() && (
            <p className="mt-4 text-label text-muted">
              Need a file to try?{" "}
              <a
                href="/api/revenue-cycle/sample-file"
                download
                className="font-medium text-link hover:underline"
              >
                Download a synthetic sample file
              </a>{" "}
              for this practice&apos;s sites.
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}
