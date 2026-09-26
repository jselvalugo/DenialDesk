import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { daysUntil } from "@rules/deadlines";
import { canWorkAppeals } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Code } from "@/components/ui/Code";
import { DeadlineIndicator } from "@/components/ui/DeadlineIndicator";
import { Money } from "@/components/ui/Money";
import { Panel } from "@/components/ui/Panel";
import { MaskedMemberId } from "@/components/patients/MaskedMemberId";
import { withTenant } from "@/db/tenant";
import { CARC, CATEGORY_LABELS } from "@/domain/carc";
import { DUE_SOON_DAYS, getAppeal } from "@/domain/appeals/queries";
import {
  APPEAL_DECISION_OUTCOME_LABELS,
  APPEAL_LEVEL_LABELS,
  APPEAL_STATUSES,
  APPEAL_SUBMITTED_METHOD_LABELS,
} from "@/domain/appeals/status";
import { audit } from "@/lib/audit";
import { formatDate } from "@/lib/format";
import { AppealNoteForm, DecisionForm, SubmissionForm } from "./controls";
import { revealMemberId } from "./actions";

export const metadata: Metadata = { title: "Appeal" };

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
  "appeal.created": "Started the appeal",
  "appeal.submission_recorded": "Recorded the submission",
  "appeal.decision_recorded": "Recorded the decision",
  "appeal.note_added": "Added a note",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-label font-medium text-muted">{label}</dt>
      <dd className="text-body text-text">{children}</dd>
    </div>
  );
}

export default async function AppealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();
  const today = todayIn();

  const detail = await withTenant(auth, async (tx) => {
    const row = await getAppeal(tx, id);
    if (!row) return null;
    await audit(tx, {
      action: "appeal.viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "appeal",
      entityId: id,
      metadata: { denialId: row.denial.id },
    });
    return row;
  });
  if (!detail) notFound();

  const { appeal, denial, claim, payer, patient, deniedLine } = detail;
  const status = APPEAL_STATUSES[appeal.status];
  const carc = CARC[denial.carc];
  const canWork = canWorkAppeals(auth.role);
  const canSubmit = canWork && ["draft", "in_review", "ready"].includes(appeal.status);
  const canDecide = canWork && ["submitted", "awaiting_decision"].includes(appeal.status);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-label text-muted">
        <Link href="/appeals" className="font-medium text-link hover:underline">
          Appeals
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
            {APPEAL_LEVEL_LABELS[appeal.level] ?? appeal.level} · {payer.name} ·{" "}
            <Link href={`/denials/${denial.id}`} className="font-medium text-link hover:underline">
              View the denial
            </Link>
          </p>
        </div>
      </header>
      {!canWork && (
        <p
          role="note"
          className="rounded-control border border-info-border bg-info-bg px-3 py-2 text-body text-info-fg"
        >
          You have read-only access to appeals.
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
                  <span>{carc?.summary ?? "Code not in DenialDesk's reference list yet."}</span>
                </dd>
              </div>
              <Field label="Category">{CATEGORY_LABELS[denial.category]}</Field>
              <Field label="Denied amount">
                <Money cents={denial.deniedCents} className="font-semibold" />
              </Field>
              <Field label="Applies to">
                {deniedLine ? `Line ${deniedLine.lineNumber} · ${deniedLine.procedureCode}` : "Whole claim"}
              </Field>
            </dl>
          </Panel>

          {canSubmit && (
            <Panel title="Record submission">
              <SubmissionForm appealId={appeal.id} today={today} disabled={!canSubmit} />
            </Panel>
          )}

          {appeal.submittedOn && (
            <Panel title="Submission">
              <dl className="grid grid-cols-3 gap-x-6 gap-y-4">
                <Field label="Method">
                  {appeal.submittedMethod ? APPEAL_SUBMITTED_METHOD_LABELS[appeal.submittedMethod] : "—"}
                </Field>
                <Field label="Submitted">
                  <span className="tabular">{formatDate(appeal.submittedOn)}</span>{" "}
                  {appeal.deadline ? (
                    appeal.submittedOn <= appeal.deadline ? (
                      <Badge tone="success">On time</Badge>
                    ) : (
                      <Badge tone="danger">Late</Badge>
                    )
                  ) : null}
                </Field>
                <Field label="Tracking / reference">{appeal.trackingReference ?? "—"}</Field>
                <Field label="Follow-up">
                  {appeal.followUpOn ? <span className="tabular">{formatDate(appeal.followUpOn)}</span> : "—"}
                </Field>
              </dl>
            </Panel>
          )}

          {canDecide && (
            <Panel title="Record decision">
              <DecisionForm
                appealId={appeal.id}
                today={today}
                minDate={appeal.submittedOn ?? appeal.createdAt.toISOString().slice(0, 10)}
                deniedCents={denial.deniedCents}
                disabled={!canDecide}
              />
            </Panel>
          )}

          {appeal.decisionOutcome && (
            <Panel title="Decision">
              <dl className="grid grid-cols-3 gap-x-6 gap-y-4">
                <Field label="Outcome">{APPEAL_DECISION_OUTCOME_LABELS[appeal.decisionOutcome]}</Field>
                <Field label="Decided">
                  {appeal.decisionOn ? <span className="tabular">{formatDate(appeal.decisionOn)}</span> : "—"}
                </Field>
                <Field label="Recovered">
                  {appeal.recoveredCents !== null ? <Money cents={appeal.recoveredCents} /> : "—"}
                </Field>
                {appeal.closeReason && (
                  <div className="col-span-3">
                    <Field label="Reason">{appeal.closeReason}</Field>
                  </div>
                )}
              </dl>
            </Panel>
          )}

          <Panel title="Notes" description="Visible to everyone on this practice's team.">
            <div className="flex flex-col gap-5">
              <AppealNoteForm appealId={appeal.id} disabled={!canWork} />
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
          <Panel title="Deadline">
            {appeal.deadline ? (
              <div className="flex flex-col gap-3">
                {status.awaitingAction ? (
                  <DeadlineIndicator
                    dueDate={appeal.deadline}
                    daysRemaining={daysUntil(appeal.deadline, today)}
                    dueSoonDays={DUE_SOON_DAYS}
                  />
                ) : (
                  <span className="tabular text-body">{formatDate(appeal.deadline)}</span>
                )}
                <p className="text-label text-muted">
                  {appeal.deadlineBasis === "payer_contract"
                    ? `From the payer contract: ${payer.appealWindowDays} days after the notice date${payer.appealWindowSource ? ` (${payer.appealWindowSource})` : ""}.`
                    : appeal.deadlineCitation}
                </p>
              </div>
            ) : (
              <p className="text-body text-warning-fg">No appeal window is configured for {payer.name}.</p>
            )}
          </Panel>

          <Panel title="Claim & patient">
            <dl className="flex flex-col gap-3">
              <Field label="Claim">
                <Link
                  href={`/denials/${denial.id}`}
                  className="font-mono font-medium text-link hover:underline"
                >
                  {claim.claimNumber}
                </Link>
              </Field>
              <Field label="Billed">
                <Money cents={claim.billedCents} />
              </Field>
              <Field label="Patient">
                <Link href={`/patients/${patient.id}`} className="font-medium text-link hover:underline">
                  {patient.lastName}, {patient.firstName}
                </Link>
              </Field>
              <Field label="MRN">
                <span className="font-mono">{patient.mrn}</span>
              </Field>
              <Field label="Member ID">
                {canWork ? (
                  <MaskedMemberId
                    last4={patient.memberIdLast4}
                    reveal={revealMemberId.bind(null, appeal.id)}
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
