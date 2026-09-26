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
import { syntheticDataOnly } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { DepositUploadForm, ReverseDepositsForm } from "./DepositUploadForm";

export const metadata: Metadata = { title: "Deposits" };

export default async function DepositsPage() {
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  const { files, openMonths } = await withTenant(auth, async (tx) => ({
    files: await listDepositFiles(tx),
    openMonths: await monthsWithoutDeposits(tx),
  }));
  const isAdmin = canConfigureRevenueCycle(auth.role);
  const synthetic = syntheticDataOnly();

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader
        title="Deposits"
        description="Bank deposits, reconciled month by month against the payments posted in the practice-management system."
      />

      <Panel title="Imported deposit files" description={`${files.length} files, newest first`} flush>
        {files.length === 0 ? (
          <EmptyState
            title="No deposits imported yet"
            description="Import the bank's deposit export to reconcile it with posted payments on the A/R aging page."
          />
        ) : (
          <Table caption="Imported deposit files">
            <thead>
              <tr>
                <Th>Imported</Th>
                <Th>Deposit dates</Th>
                <Th numeric>Deposits</Th>
                <Th numeric>Total</Th>
                <Th>By</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <Tr key={f.id}>
                  <Td>{f.createdAt.toLocaleDateString("en-US", { timeZone: "America/New_York" })}</Td>
                  <Td className="tabular">
                    {f.dateFrom && f.dateTo ? `${formatDate(f.dateFrom)}–${formatDate(f.dateTo)}` : "—"}
                  </Td>
                  <Td numeric>{f.rowCount.toLocaleString("en-US")}</Td>
                  <Td numeric>
                    <Money cents={f.totalCents} />
                  </Td>
                  <Td className="text-muted">{f.uploadedBy ?? "—"}</Td>
                  <Td>
                    {f.reversesFileId ? (
                      <Badge tone="neutral">Reversal</Badge>
                    ) : f.reversedBy ? (
                      <Badge tone="danger">Reversed</Badge>
                    ) : isAdmin ? (
                      <ReverseDepositsForm fileId={f.id} />
                    ) : (
                      <Badge tone="success">Active</Badge>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {canRunRevenueCycle(auth.role) && (
        <Panel
          title="Import deposits"
          description="CSV with a Date column and an Amount column (negative for returned items). Other columns, such as descriptions or account numbers, are ignored and never stored. A file may not overlap the dates of one already imported; reverse the earlier file first."
        >
          <DepositUploadForm syntheticOnly={synthetic} />
          {synthetic && (
            <p className="mt-4 text-label text-muted">
              {openMonths.length > 0 ? (
                <>
                  Need a file to try?{" "}
                  <a
                    href="/api/revenue-cycle/sample-deposits"
                    download
                    className="font-medium text-link hover:underline"
                  >
                    Download synthetic deposits
                  </a>{" "}
                  for the {openMonths.length} imported months without deposits.
                </>
              ) : (
                "Every imported month already has deposits. Import a new month's activity file to try another deposit file."
              )}
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}
