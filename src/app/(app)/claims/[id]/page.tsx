import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { canCorrectClaims } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { DeadlineIndicator } from "@/components/ui/DeadlineIndicator";
import { Money } from "@/components/ui/Money";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { CATEGORY_LABELS } from "@/domain/carc";
import { diffSnapshots } from "@/domain/claims/correction";
import { getClaim } from "@/domain/claims/queries";
import { CLAIM_STATUSES, FILING_WARNING_DAYS, filingStatus, isUnsubmitted } from "@/domain/claims/status";
import { DENIAL_STATUSES, REGIME_LABELS } from "@/domain/denial-status";
import { audit } from "@/lib/audit";
import { formatDate } from "@/lib/format";
import { CorrectionForm } from "./CorrectionForm";

// The title never includes patient data (DESIGN.md §12).
export const metadata: Metadata = { title: "Claim" };

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "2-digit",
  day: "2-digit",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
  timeZoneName: "short",
});

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-label font-medium text-muted">{label}</dt>
      <dd className="text-body text-text">{children}</dd>
    </div>
  );
}

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();
  const today = todayIn();

  const detail = await withTenant(auth, async (tx) => {
    const detail = await getClaim(tx, id);
    if (!detail) return null;
    await audit(tx, {
      action: "claim.viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "claim",
      entityId: id,
      // Whose record was shown, for accounting of disclosures (IDs only).
      metadata: { patientId: detail.patient.id },
    });
    return detail;
  });
  if (!detail) notFound();

  const { claim, patient, payer } = detail;
  const status = CLAIM_STATUSES[claim.status];
  const unsubmitted = isUnsubmitted(claim.status);
  const filing = filingStatus(payer.regime, claim.serviceDate, today);
  // Sent but not yet confirmed received (999/277CA capture is phase C4): the window still matters.
  const awaitingReceipt = claim.status === "submitted" && !claim.payerReceivedDate;
  const showDeadline = unsubmitted || awaitingReceipt;
  const canCorrect = canCorrectClaims(auth.role) && unsubmitted;
  const snapshots = new Map(detail.history.map((v) => [v.version, v.snapshot]));

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-label text-muted">
        <Link href="/claims" className="font-medium text-link hover:underline">
          Claims
        </Link>{" "}
        <span aria-hidden>/</span> <span className="font-mono">{claim.claimNumber}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-border pb-5">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-[1.5rem] leading-8 font-bold text-primary">{claim.claimNumber}</h1>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <p className="mt-1 text-body text-muted">
            {payer.name} · date of service {formatDate(claim.serviceDate)} · version {claim.version}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] items-start gap-6">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Claim" flush>
            <dl className="grid grid-cols-4 gap-x-6 gap-y-4 p-4">
              <Field label="Date of service">
                <span className="tabular">{formatDate(claim.serviceDate)}</span>
              </Field>
              <Field label="Provider">
                {detail.providerName}
                <span className="block font-mono text-label text-muted">NPI {detail.providerNpi}</span>
              </Field>
              <Field label="Location">{detail.locationName}</Field>
              <Field label="Payer">
                {payer.name}
                <span className="block text-label text-muted">{REGIME_LABELS[payer.regime]}</span>
              </Field>
              <Field label="Billed">
                <Money cents={claim.billedCents} />
              </Field>
              <Field label="Paid">
                <Money cents={claim.paidCents} />
              </Field>
              <Field label="Payer received">
                <span className="tabular">
                  {claim.payerReceivedDate ? formatDate(claim.payerReceivedDate) : "—"}
                </span>
              </Field>
              <Field label="Diagnosis">
                <span className="flex flex-wrap gap-1">
                  {claim.diagnosisCodes.map((code) => (
                    <Code key={code}>{code}</Code>
                  ))}
                </span>
              </Field>
            </dl>
            <div className="border-t border-border">
              <Table caption="Claim lines">
                <thead>
                  <tr>
                    <Th>Line</Th>
                    <Th>Procedure</Th>
                    <Th>Modifiers</Th>
                    <Th numeric>Units</Th>
                    <Th numeric>Charge</Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((line) => (
                    <Tr key={line.id}>
                      <Td className="tabular">{line.lineNumber}</Td>
                      <Td>
                        <Code>{line.procedureCode}</Code>
                      </Td>
                      <Td className="text-muted">{line.modifiers.join(", ") || "—"}</Td>
                      <Td numeric>{line.units}</Td>
                      <Td numeric>
                        <Money cents={line.chargeCents} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
            {canCorrect && (
              <div className="border-t border-border p-4">
                <CorrectionForm
                  claimId={claim.id}
                  version={claim.version}
                  serviceDate={claim.serviceDate}
                  diagnosisCodes={claim.diagnosisCodes}
                  lines={detail.lines.map((l) => ({
                    lineNumber: l.lineNumber,
                    procedureCode: l.procedureCode,
                    modifiers: l.modifiers,
                    units: l.units,
                    chargeCents: l.chargeCents,
                  }))}
                />
              </div>
            )}
            {!canCorrect && unsubmitted && (
              <p role="note" className="border-t border-border px-4 py-3 text-body text-muted">
                You have read-only access to claims.
              </p>
            )}
          </Panel>

          <Panel
            title="Version history"
            description="Every change to this claim: who, when, and why. History can't be edited."
          >
            <ol className="flex flex-col divide-y divide-border" aria-label="Claim versions">
              {detail.history.map((entry) => {
                const previous = snapshots.get(entry.version - 1);
                const changes = previous ? diffSnapshots(previous, entry.snapshot) : [];
                return (
                  <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-label text-muted">
                      <span className="font-medium text-text">Version {entry.version}</span> ·{" "}
                      {entry.author ?? (entry.changedBy ? "Former team member" : "System")} ·{" "}
                      {dateTime.format(entry.createdAt)}
                    </p>
                    <p className="mt-1 text-body whitespace-pre-wrap text-text">{entry.reason}</p>
                    {changes.length > 0 && (
                      <ul className="mt-2 flex flex-col gap-1 text-label">
                        {changes.map((change) => (
                          <li key={change.label}>
                            <span className="font-medium text-text">{change.label}</span>:{" "}
                            <span className="font-mono text-muted line-through">{change.from}</span>{" "}
                            <span aria-hidden>→</span>
                            <span className="sr-only">changed to</span>{" "}
                            <span className="font-mono text-text">{change.to}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Timely filing">
            {!showDeadline ? (
              <p className="text-body text-muted">
                {claim.payerReceivedDate
                  ? `Received by the payer ${formatDate(claim.payerReceivedDate)}.`
                  : "Accepted by the payer."}{" "}
                Timely filing no longer applies.
              </p>
            ) : filing.deadline && filing.daysRemaining !== null ? (
              <div className="flex flex-col gap-3">
                {awaitingReceipt && (
                  <p className="text-body text-text">
                    Sent; the filing window is met once the payer confirms receipt.
                  </p>
                )}
                <DeadlineIndicator
                  dueDate={filing.deadline.date}
                  daysRemaining={filing.daysRemaining}
                  dueSoonDays={FILING_WARNING_DAYS}
                />
                {filing.state === "past_deadline" && (
                  <p className="text-body text-danger-fg">
                    The filing window has closed. The payer is likely to deny this claim as untimely unless an
                    exception applies.
                  </p>
                )}
                <p className="text-label text-muted">
                  From the date of service ({filing.deadline.citation}).
                </p>
                {filing.deadline.verify && <Badge tone="warning">Pending counsel verification</Badge>}
              </div>
            ) : (
              <p className="text-body text-warning-fg">
                DenialDesk has no filing rule configured for {REGIME_LABELS[payer.regime]} claims. Confirm the
                filing window with the payer contract or applicable law before it lapses.
              </p>
            )}
          </Panel>

          <Panel title="Patient">
            <dl className="flex flex-col gap-3">
              <Field label="Name">
                <Link href={`/patients/${patient.id}`} className="font-medium text-link hover:underline">
                  {patient.lastName}, {patient.firstName}
                </Link>
              </Field>
              <Field label="Date of birth">
                <span className="tabular">{formatDate(patient.birthDate)}</span>
              </Field>
              <Field label="MRN">
                <span className="font-mono">{patient.mrn}</span>
              </Field>
              <Field label="Member ID">
                <span className="font-mono">•••• {patient.memberIdLast4}</span>
              </Field>
            </dl>
          </Panel>

          <Panel title="Denials">
            {detail.denials.length === 0 ? (
              <p className="text-body text-muted">No denials on this claim.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {detail.denials.map((denial) => (
                  <li key={denial.id} className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <Link href={`/denials/${denial.id}`} className="font-medium text-link hover:underline">
                        {CATEGORY_LABELS[denial.category]}
                      </Link>
                      <span className="block text-label text-muted">
                        {denial.groupCode}-{denial.carc} · notice {formatDate(denial.noticeDate)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <Money cents={denial.deniedCents} className="block" />
                      <Badge tone={DENIAL_STATUSES[denial.status].tone}>
                        {DENIAL_STATUSES[denial.status].label}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
