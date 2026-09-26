import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canRunRevenueCycle, canViewRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { listDepositFiles } from "@/domain/revenue-cycle/receivables";
import { syntheticDataOnly } from "@/lib/env";
import { DepositUploadForm } from "./DepositUploadForm";

export const metadata: Metadata = { title: "Deposits" };

export default async function DepositsPage() {
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  const files = await withTenant(auth, (tx) => listDepositFiles(tx));

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
                <Th numeric>Deposits</Th>
                <Th numeric>Total</Th>
                <Th>By</Th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <Tr key={f.id}>
                  <Td>{f.createdAt.toLocaleDateString("en-US", { timeZone: "America/New_York" })}</Td>
                  <Td numeric>{f.rowCount.toLocaleString("en-US")}</Td>
                  <Td numeric>
                    <Money cents={f.totalCents} />
                  </Td>
                  <Td className="text-muted">{f.uploadedBy ?? "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      {canRunRevenueCycle(auth.role) && (
        <Panel
          title="Import deposits"
          description="CSV with a Date column and an Amount column (negative for returned items). Other columns, such as descriptions or account numbers, are ignored and never stored."
        >
          <DepositUploadForm />
          {syntheticDataOnly() && (
            <p className="mt-4 text-label text-muted">
              Need a file to try?{" "}
              <a
                href="/api/revenue-cycle/sample-deposits"
                download
                className="font-medium text-link hover:underline"
              >
                Download synthetic deposits
              </a>{" "}
              for this practice&apos;s imported months.
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}
