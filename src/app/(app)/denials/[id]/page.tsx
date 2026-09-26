import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { daysUntil, payerResponseStatus, promptPayMilestones, rulesForBasis } from "@rules/deadlines";
import { canWorkDenials } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { DeadlineIndicator } from "@/components/ui/DeadlineIndicator";
import { Money } from "@/components/ui/Money";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { CARC, CATEGORY_LABELS } from "@/domain/carc";
import { DENIAL_STATUSES, regimeLabel } from "@/domain/denial-status";
import { DUE_SOON_DAYS, getDenial, teamMembers } from "@/domain/denials/queries";
import { audit } from "@/lib/audit";
import { formatDate } from "@/lib/format";
import { MaskedMemberId } from "@/components/patients/MaskedMemberId";
import { revealMemberId } from "./actions";
import { AssignControl, NoteForm, StatusControl } from "./controls";

// The title never includes patient data (DESIGN.md §12).
export const metadata: Metadata = { title: "Denial" };

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "2-digit",
  day: "2-digit",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
  timeZoneName: "short",
});

const ACTIVITY_LABELS: Record<string, string> = {
  "denial.status_changed": "Changed status",
  "denial.assigned": "Changed assignee",
  "denial.note_added": "Added a note",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-label font-medium text-muted">{label}</dt>
      <dd className="text-body text-text">{children}</dd>
    </div>
  );
}

export default async function DenialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();
  const today = todayIn();

  const data = await withTenant(auth, async (tx) => {
    const detail = await getDenial(tx, id);
    if (!detail) return null;
    const team = await teamMembers(tx, auth.tenantId);
    await audit(tx, {
      action: "denial.viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "denial",
      entityId: id,
    });
    return { detail, team };
  });
  if (!data) notFound();

  const { detail, team } = data;
  const { denial, claim, patient, payer } = detail;
  const status = DENIAL_STATUSES[denial.status];
  const carc = CARC[denial.carc];
  const canWork = canWorkDenials(auth.role);
  const deniedLine = detail.lines.find((line) => line.id === denial.claimLineId);
  // Prompt-pay milestones need a verified regime; an unverified payer gets no computed deadline
  // (spec: payer-catalog P1) rather than a guessed one.
  const milestones =
    claim.payerReceivedDate && payer.regime !== null
      ? promptPayMilestones({
          regime: payer.regime,
          electronic: claim.electronic,
          receivedDate: claim.payerReceivedDate,
        })
      : null;
  // Deadline explanation comes from the rules that produced it, never from text in this page.
  const basisRules =
    denial.appealDeadlineBasis && denial.appealDeadlineBasis !== "payer_contract"
      ? rulesForBasis(denial.appealDeadlineBasis, denial.noticeDate)
      : [];
  const deadlineVerify = basisRules.some((rule) => rule.verify);
  const milestonesVerify = milestones?.some(({ rule }) => rule.verify) ?? false;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-label text-muted">
        <Link href="/denials" className="font-medium text-link hover:underline">
          Denial queue
        </Link>{" "}
        <span aria-hidden>/</span> <span className="font-mono">{claim.claimNumber}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-6 rounded-panel border border-border bg-surface px-5 py-4 shadow-xs">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-[1.5rem] leading-8 font-bold text-primary">{claim.claimNumber}</h1>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <p className="mt-1 text-body text-muted">
            {CATEGORY_LABELS[denial.category]} denial · {payer.name} · notice dated{" "}
            {formatDate(denial.noticeDate)}
            {denial.remittanceId && (
              <>
                {" · "}
                <Link
                  href={`/remittances/${denial.remittanceId}`}
                  className="font-medium text-link hover:underline"
                >
                  captured from remittance
                </Link>{" "}
                <Badge tone="warning">Category unverified</Badge>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-4">
          <AssignControl denialId={denial.id} current={denial.assigneeId} team={team} disabled={!canWork} />
          <StatusControl
            denialId={denial.id}
            current={denial.status}
            disabled={!canWork}
            options={Object.entries(DENIAL_STATUSES).map(([value, s]) => ({ value, label: s.label }))}
          />
        </div>
      </header>
      {!canWork && (
        <p
          role="note"
          className="rounded-control border border-info-border bg-info-bg px-3 py-2 text-body text-info-fg"
        >
          You have read-only access to denials.
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] items-start gap-6">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Denial">
            <dl className="grid grid-cols-3 gap-x-6 gap-y-4">
              <div className="col-span-3 flex flex-col gap-1">
                <dt className="text-label font-medium text-muted">Reason</dt>
                <dd className="flex items-start gap-2 text-body text-text">
                  <Code>CARC {denial.carc}</Code>
                  <span>
                    {carc?.summary ?? "Code not in DenialDesk's reference list yet."}
                    {carc && <span className="ml-1 text-label text-subtle">(summary)</span>}
                  </span>
                </dd>
              </div>
              <Field label="Group code">
                <Code>{denial.groupCode}</Code>
              </Field>
              <Field label="Remark codes">
                {denial.rarcs.length ? (
                  <span className="flex gap-1">
                    {denial.rarcs.map((r) => (
                      <Code key={r}>RARC {r}</Code>
                    ))}
                  </span>
                ) : (
                  <span className="text-subtle">None</span>
                )}
              </Field>
              <Field label="Denied amount">
                <Money cents={denial.deniedCents} className="font-semibold" />
              </Field>
              <Field label="Applies to">
                {deniedLine ? `Line ${deniedLine.lineNumber} · ${deniedLine.procedureCode}` : "Whole claim"}
              </Field>
              <Field label="Category">{CATEGORY_LABELS[denial.category]}</Field>
              <Field label="Assignee">
                {detail.assigneeName ?? <span className="text-subtle">Unassigned</span>}
              </Field>
            </dl>
          </Panel>

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
                <span className="block text-label text-muted">{regimeLabel(payer.regime)}</span>
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
                    <Tr key={line.id} selected={line.id === denial.claimLineId}>
                      <Td className="tabular">{line.lineNumber}</Td>
                      <Td>
                        <Code>{line.procedureCode}</Code>
                        {line.id === denial.claimLineId && (
                          <span className="ml-2 text-label font-medium text-danger-fg">Denied line</span>
                        )}
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
          </Panel>

          <Panel title="Notes" description="Visible to everyone on this practice's team.">
            <div className="flex flex-col gap-5">
              <NoteForm denialId={denial.id} disabled={!canWork} />
              {detail.notes.length === 0 ? (
                <p className="text-body text-muted">No notes yet.</p>
              ) : (
                <ol className="flex flex-col divide-y divide-border border-t border-border">
                  {detail.notes.map((note) => (
                    <li key={note.id} className="py-3">
                      <p className="text-label text-muted">
                        <span className="font-medium text-text">{note.author}</span> ·{" "}
                        {dateTime.format(note.createdAt)}
                      </p>
                      <p className="mt-1 text-body whitespace-pre-wrap text-text">{note.body}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Appeal deadline">
            {denial.appealDeadline ? (
              <div className="flex flex-col gap-3">
                {denial.appealSubmittedOn && (
                  <p className="flex items-center gap-2 text-body text-text">
                    Appeal filed {formatDate(denial.appealSubmittedOn)}
                    {denial.appealSubmittedOn <= denial.appealDeadline ? (
                      <Badge tone="success">On time</Badge>
                    ) : (
                      <Badge tone="danger">After deadline</Badge>
                    )}
                  </p>
                )}
                {status.awaitingAction ? (
                  <DeadlineIndicator
                    dueDate={denial.appealDeadline}
                    daysRemaining={daysUntil(denial.appealDeadline, today)}
                    dueSoonDays={DUE_SOON_DAYS}
                  />
                ) : (
                  <span className="tabular text-body">{formatDate(denial.appealDeadline)}</span>
                )}
                <p className="text-label text-muted">
                  {denial.appealDeadlineBasis === "payer_contract"
                    ? `From the payer contract: ${payer.appealWindowDays} days after the notice date${payer.appealWindowSource ? ` (${payer.appealWindowSource})` : ""}.`
                    : basisRules
                        .map((rule) => `${rule.title}: ${rule.value} days (${rule.citation}).`)
                        .join(" ")}
                </p>
                {deadlineVerify && <Badge tone="warning">Pending counsel verification</Badge>}
              </div>
            ) : (
              <p className="text-body text-warning-fg">
                No appeal window is configured for {payer.name}. Add it from the payer contract so this denial
                can be prioritized.
              </p>
            )}
          </Panel>

          {milestones && (
            <Panel
              title="Florida prompt pay"
              description={`Counted from payer receipt (${formatDate(claim.payerReceivedDate!)}); compared with the denial notice (${formatDate(denial.noticeDate)}).`}
            >
              <ol className="flex flex-col gap-3">
                {milestones.map(({ rule, date }) => {
                  // The denial notice is the payer's response; compare it to each obligation.
                  const response = payerResponseStatus(date, denial.noticeDate);
                  return (
                    <li key={rule.id} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-body text-text">{rule.title}</p>
                        <p className="text-label text-muted">
                          Day {rule.value} · {rule.citation}
                        </p>
                      </div>
                      <span className="shrink-0 text-right">
                        <span className="tabular block text-body">{formatDate(date)}</span>
                        {response.met ? (
                          <span className="block text-label font-medium text-success-fg">Met</span>
                        ) : (
                          <span className="tabular block text-label font-medium text-danger-fg">
                            Payer late by {response.daysLate} {response.daysLate === 1 ? "day" : "days"}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-4 border-t border-border pt-3 text-label text-muted">
                Deadlines are payer obligations under Florida law.
                {milestonesVerify && " Values are pending counsel verification."}
              </p>
            </Panel>
          )}

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
                {canWork ? (
                  <MaskedMemberId
                    last4={patient.memberIdLast4}
                    reveal={revealMemberId.bind(null, denial.id)}
                  />
                ) : (
                  <span className="font-mono">•••• {patient.memberIdLast4}</span>
                )}
              </Field>
            </dl>
          </Panel>

          <Panel title="Activity">
            {detail.activity.length === 0 ? (
              <p className="text-body text-muted">No changes yet.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {detail.activity.map((event) => (
                  <li key={event.id} className="text-body">
                    <p className="text-text">
                      <span className="font-medium">{event.actor ?? "System"}</span>{" "}
                      {ACTIVITY_LABELS[event.action]?.toLowerCase() ?? event.action}
                      {event.action === "denial.status_changed" && event.metadata?.to
                        ? ` to ${DENIAL_STATUSES[event.metadata.to as keyof typeof DENIAL_STATUSES]?.label ?? event.metadata.to}`
                        : ""}
                    </p>
                    <p className="text-label text-muted">{dateTime.format(event.occurredAt)}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
