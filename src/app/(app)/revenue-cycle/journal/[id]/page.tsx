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
import { allPassed } from "@/domain/revenue-cycle/journal";
import { getVoucher } from "@/domain/revenue-cycle/vouchers";
import { formatCents } from "@/lib/format";
import { VoucherStatusBadge } from "../VoucherStatusBadge";
import { ApproveVoucherForm, ExportVoucherButton, VoidVoucherForm } from "../VoucherForms";

export const metadata: Metadata = { title: "Journal voucher" };

const when = (date: Date | null) =>
  date?.toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });

export default async function VoucherPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const detail = await withTenant(auth, (tx) => getVoucher(tx, id));
  if (!detail) notFound();
  const { voucher, lines, checks } = detail;
  const passed = allPassed(checks);
  const canRun = canRunRevenueCycle(auth.role);
  const isPreparer = voucher.preparedBy === auth.userId;
  const period = periodLabel(voucher.periodYear, voucher.periodMonth);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <p className="text-label text-muted">
        <Link href="/revenue-cycle/journal" className="text-link hover:underline">
          Journal vouchers
        </Link>{" "}
        / {voucher.number}
      </p>
      <PageHeader
        title={`${period} voucher`}
        description={`${voucher.number} · prepared by ${detail.preparedByName ?? "unknown"} on ${when(voucher.createdAt)}`}
      />

      <section aria-label="Voucher summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Status" value={<VoucherStatusBadge status={voucher.status} />} />
        <StatTile label="Total debits" value={formatCents(voucher.debitCents)} />
        <StatTile label="Total credits" value={formatCents(voucher.creditCents)} />
        <StatTile
          label="Checks passed"
          value={`${checks.filter((c) => c.passed).length} of ${checks.length}`}
          detail={passed ? "Ready for approval" : "Fix the failing checks before approval"}
          emphasis={passed ? undefined : "danger"}
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Panel
          title="Checks"
          description="Recomputed from the source file and chart of accounts every time"
          flush
        >
          <ul className="divide-y divide-border" aria-label="Voucher checks">
            {checks.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                <Badge tone={c.passed ? "success" : "danger"}>{c.passed ? "Pass" : "Fail"}</Badge>
                <div>
                  <p className="font-medium text-text">{c.label}</p>
                  <p className="text-label text-muted">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Workflow">
          <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-body">
            <dt className="text-muted">Source file</dt>
            <dd>
              <Link href={`/revenue-cycle/files/${voucher.fileId}`} className="text-link hover:underline">
                {period} activity file
              </Link>
            </dd>
            {voucher.approvedAt && (
              <>
                <dt className="text-muted">Approved</dt>
                <dd>
                  {detail.approvedByName ?? "unknown"} · {when(voucher.approvedAt)}
                </dd>
              </>
            )}
            {voucher.exportedAt && (
              <>
                <dt className="text-muted">First exported</dt>
                <dd>
                  {detail.exportedByName ?? "unknown"} · {when(voucher.exportedAt)}
                </dd>
              </>
            )}
            {voucher.voidedAt && (
              <>
                <dt className="text-muted">Voided</dt>
                <dd>
                  {detail.voidedByName ?? "unknown"} · {when(voucher.voidedAt)}
                  <p className="text-label text-muted">{voucher.voidReason}</p>
                </dd>
              </>
            )}
          </dl>
          <div className="flex flex-col items-start gap-4">
            {voucher.status === "draft" &&
              canRun &&
              (isPreparer ? (
                <p className="text-body text-muted">
                  You prepared this voucher, so another administrator or RCM manager must approve it.
                </p>
              ) : passed ? (
                <ApproveVoucherForm voucherId={voucher.id} />
              ) : (
                <p className="text-body text-muted">Approval is available once every check passes.</p>
              ))}
            {(voucher.status === "approved" || voucher.status === "exported") && canRun && (
              <ExportVoucherButton
                voucherId={voucher.id}
                label={voucher.status === "approved" ? "Export GL file" : "Download GL file again"}
              />
            )}
            {(voucher.status === "approved" || voucher.status === "exported") &&
              canConfigureRevenueCycle(auth.role) && <VoidVoucherForm voucherId={voucher.id} />}
            {voucher.status === "superseded" && (
              <p className="text-body text-muted">A newer draft for {period} replaced this voucher.</p>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Lines" description={`${lines.length} lines`} flush>
        <Table caption="Voucher lines">
          <thead>
            <tr>
              <Th numeric>#</Th>
              <Th>Account</Th>
              <Th>Site</Th>
              <Th>Memo</Th>
              <Th numeric>Debit</Th>
              <Th numeric>Credit</Th>
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
