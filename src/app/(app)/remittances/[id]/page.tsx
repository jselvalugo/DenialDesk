import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { canPostRemittances, canVoidRemittances } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { Money } from "@/components/ui/Money";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { CATEGORY_LABELS } from "@/domain/carc";
import { DENIAL_STATUSES } from "@/domain/denial-status";
import { getRemittance } from "@/domain/remittances/queries";
import {
  CLP_STATUS_LABELS,
  isBalanced,
  METHOD_LABELS,
  REMITTANCE_STATUSES,
} from "@/domain/remittances/status";
import { audit } from "@/lib/audit";
import { formatDate, formatDateTime } from "@/lib/format";
import { RemittanceActions } from "./RemittanceActions";

// The title never includes patient data (DESIGN.md §12).
export const metadata: Metadata = { title: "Remittance" };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-label font-medium text-muted">{label}</dt>
      <dd className="text-body text-text">{children}</dd>
    </div>
  );
}

const EVENT_LABELS = { received: "Loaded", posted: "Posted", void: "Voided" } as const;

export default async function RemittancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();

  const detail = await withTenant(auth, async (tx) => {
    const detail = await getRemittance(tx, id);
    if (!detail) return null;
    await audit(tx, {
      action: "remittance.viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "remittance",
      entityId: id,
      // Whose records were shown, for accounting of disclosures (IDs only).
      metadata: { patientIds: [...new Set(detail.lines.map((l) => l.patientId))].join(",") },
    });
    return detail;
  });
  if (!detail) notFound();

  const { remittance, lines, history } = detail;
  const status = REMITTANCE_STATUSES[remittance.status];
  const claimsPaid = lines.reduce((sum, l) => sum + l.paidCents, 0);
  const balanced = isBalanced({
    totalPaidCents: remittance.totalPaidCents,
    providerAdjustmentCents: remittance.providerAdjustmentCents,
    claimsPaidCents: claimsPaid,
  });
  const ready = remittance.status === "received";
  const canPost = ready && canPostRemittances(auth.role);
  const canVoid = ready && canVoidRemittances(auth.role);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-label text-muted">
        <Link href="/remittances" className="font-medium text-link hover:underline">
          Remittances
        </Link>{" "}
        <span aria-hidden>/</span> <span className="font-mono">{remittance.traceNumber}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-6 rounded-panel border border-border bg-surface px-5 py-4 shadow-xs">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-[1.5rem] leading-8 font-bold text-primary">
              {remittance.traceNumber}
            </h1>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <p className="mt-1 text-body text-muted">
            {detail.payerName} · {METHOD_LABELS[remittance.method]} · paid{" "}
            {formatDate(remittance.paymentDate)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-label font-medium text-muted">Total paid</p>
          <Money cents={remittance.totalPaidCents} className="text-[1.5rem] leading-8 font-bold" />
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] items-start gap-6">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Payment" flush>
            <dl className="grid grid-cols-4 gap-x-6 gap-y-4 p-4">
              <Field label="Payer">
                {detail.payerName}
                <span className="block font-mono text-label text-muted">EDI {detail.payerEdiId}</span>
              </Field>
              <Field label="Method">{METHOD_LABELS[remittance.method]}</Field>
              <Field label="Trace number">
                <span className="font-mono">{remittance.traceNumber}</span>
              </Field>
              <Field label="Payment date">
                <span className="tabular">{formatDate(remittance.paymentDate)}</span>
              </Field>
              <Field label="Claims paid">
                <Money cents={claimsPaid} />
              </Field>
              <Field label="Provider adjustments">
                <Money cents={remittance.providerAdjustmentCents} />
              </Field>
              <Field label="Balance check">
                {balanced ? (
                  <Badge tone="success">Balances</Badge>
                ) : (
                  <Badge tone="danger">Does not balance</Badge>
                )}
              </Field>
              <Field label="Loaded by">
                {detail.loadedByName ?? (remittance.loadedBy ? "Former team member" : "System")}
                <span className="block text-label text-muted">{formatDateTime(remittance.createdAt)}</span>
              </Field>
            </dl>
          </Panel>

          <Panel
            title="Claim payments"
            description="One row per claim on this remittance (835 CLP loop)."
            flush
          >
            <Table caption="Claim payments">
              <thead>
                <tr>
                  <Th>Claim</Th>
                  <Th>Patient</Th>
                  <Th>Payer status</Th>
                  <Th numeric>Charge</Th>
                  <Th numeric>Paid</Th>
                  <Th numeric>Patient owes</Th>
                  <Th>Adjustments</Th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <Tr key={line.id}>
                    <Td>
                      <Link
                        href={`/claims/${line.claimId}`}
                        className="font-mono text-label font-medium whitespace-nowrap text-link hover:underline"
                      >
                        {line.claimNumber}
                      </Link>
                      {line.payerControlNumber && (
                        <span className="block font-mono text-label text-muted">
                          ICN {line.payerControlNumber}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Link
                        href={`/patients/${line.patientId}`}
                        className="block font-medium text-link hover:underline"
                      >
                        {line.patientLast}, {line.patientFirst.charAt(0)}.
                      </Link>
                      <span className="block font-mono text-label text-muted">{line.mrn}</span>
                    </Td>
                    <Td>
                      <span className="block">{CLP_STATUS_LABELS[line.statusCode] ?? "Other"}</span>
                      <span className="block font-mono text-label text-muted">CLP02 {line.statusCode}</span>
                    </Td>
                    <Td numeric>
                      <Money cents={line.chargeCents} />
                    </Td>
                    <Td numeric className="font-medium">
                      <Money cents={line.paidCents} />
                    </Td>
                    <Td numeric>
                      <Money cents={line.patientResponsibilityCents} />
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {line.adjustments.length === 0 && <span className="text-muted">—</span>}
                        {line.adjustments.map((a) => (
                          <Code key={`${a.group}-${a.carc}`}>
                            {a.group}-{a.carc} {(a.cents / 100).toFixed(2)}
                          </Code>
                        ))}
                        {line.rarcs.map((r) => (
                          <Code key={r}>RARC {r}</Code>
                        ))}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          {ready && (canPost || canVoid) && (
            <Panel title="Actions">
              <RemittanceActions
                remittanceId={remittance.id}
                canPost={canPost}
                canVoid={canVoid}
                balanced={balanced}
              />
            </Panel>
          )}
          {ready && !canPost && !canVoid && (
            <Panel title="Actions">
              <p className="text-body text-muted">Your role can view remittances but not post them.</p>
            </Panel>
          )}
          {detail.captured.length > 0 && (
            <Panel
              title="Denials captured"
              description="Added to the denial queue when this remittance was posted. Categories come from DenialDesk's own code mapping, pending review."
            >
              <ul className="flex flex-col gap-3">
                {detail.captured.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <Link href={`/denials/${d.id}`} className="font-medium text-link hover:underline">
                        {CATEGORY_LABELS[d.category]}
                      </Link>
                      <span className="block font-mono text-label text-muted">
                        {d.claimNumber} · {d.groupCode}-{d.carc}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <Money cents={d.deniedCents} className="block" />
                      <Badge tone={DENIAL_STATUSES[d.status].tone}>{DENIAL_STATUSES[d.status].label}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel
            title="History"
            description="Every change to this remittance: who, when, and why. History can't be edited."
          >
            <ol className="flex flex-col divide-y divide-border" aria-label="Remittance history">
              {history.map((entry) => (
                <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-label text-muted">
                    <span className="font-medium text-text">{EVENT_LABELS[entry.event]}</span> ·{" "}
                    {entry.actor ?? (entry.actorId ? "Former team member" : "System")} ·{" "}
                    {formatDateTime(entry.createdAt)}
                  </p>
                  <p className="mt-1 text-body whitespace-pre-wrap text-text">{entry.reason}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}
