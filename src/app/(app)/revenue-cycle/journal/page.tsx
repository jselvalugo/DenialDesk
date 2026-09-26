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
import { VoucherStatusBadge } from "./VoucherStatusBadge";
import { PrepareVoucherForm } from "./VoucherForms";

export const metadata: Metadata = { title: "Journal vouchers" };

export default async function JournalPage() {
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  const { vouchers, files } = await withTenant(auth, async (tx) => ({
    vouchers: await listVouchers(tx),
    files: await listFiles(tx),
  }));
  const fileOptions = files
    .filter((f) => f.formatVersion === CURRENT_FORMAT_VERSION)
    .map((f) => ({
      value: f.id,
      label: `${periodLabel(f.periodYear, f.periodMonth)} · imported ${f.createdAt.toLocaleDateString("en-US", { timeZone: "America/New_York" })}`,
    }));

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader
        title="Journal vouchers"
        description="Each month's charges, adjustments and write-offs, and payments, posted to the general ledger in balanced lines. A voucher is approved by someone other than its preparer, then exported for the GL."
      />

      {canRunRevenueCycle(auth.role) && (
        <Panel
          title="Prepare a voucher"
          description="Builds a draft from a monthly file. Preparing again for the same month replaces the draft."
        >
          {fileOptions.length === 0 ? (
            <p className="text-body text-muted">
              Import a{" "}
              <Link href="/revenue-cycle/files" className="font-medium text-link hover:underline">
                monthly file
              </Link>{" "}
              first.
            </p>
          ) : (
            <PrepareVoucherForm files={fileOptions} />
          )}
        </Panel>
      )}

      <Panel title="Vouchers" description={`${vouchers.length} vouchers, newest month first`} flush>
        {vouchers.length === 0 ? (
          <EmptyState
            title="No vouchers yet"
            description="Prepare a voucher from a monthly file to post it to the general ledger."
          />
        ) : (
          <Table caption="Journal vouchers">
            <thead>
              <tr>
                <Th>Voucher</Th>
                <Th>Month</Th>
                <Th>Status</Th>
                <Th numeric>Total debits</Th>
                <Th>Prepared by</Th>
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
                  <Td>{periodLabel(v.periodYear, v.periodMonth)}</Td>
                  <Td>
                    <VoucherStatusBadge status={v.status} />
                  </Td>
                  <Td numeric>
                    <Money cents={v.debitCents} />
                  </Td>
                  <Td className="text-muted">
                    {v.preparedBy ?? "—"} ·{" "}
                    {v.createdAt.toLocaleDateString("en-US", { timeZone: "America/New_York" })}
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
