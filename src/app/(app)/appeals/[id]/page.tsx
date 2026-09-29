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
import { secondaryLinkButtonClass } from "@/components/ui/linkButton";
import { MaskedMemberId } from "@/components/patients/MaskedMemberId";
import { withTenant } from "@/db/tenant";
import { CARC, CATEGORY_LABEL_KEYS } from "@/domain/carc";
import { getLetterSummary } from "@/domain/appeals/letter/queries";
import { DUE_SOON_DAYS, getAppeal } from "@/domain/appeals/queries";
import {
  APPEAL_DECISION_OUTCOME_LABEL_KEYS,
  APPEAL_LEVEL_LABEL_KEYS,
  APPEAL_STATUSES,
  APPEAL_SUBMITTED_METHOD_LABEL_KEYS,
  submissionTimeliness,
} from "@/domain/appeals/status";
import { getFormat, getT } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages/types";
import { audit } from "@/lib/audit";
import { AppealNoteForm, DecisionForm, SubmissionForm } from "./controls";
import { revealMemberId } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("appeals");
  return { title: t("detail.title") };
}

const ACTIVITY_KEYS: Record<string, MessageKey<"appeals">> = {
  "appeal.created": "activity.created",
  "appeal.submission_recorded": "activity.submissionRecorded",
  "appeal.decision_recorded": "activity.decisionRecorded",
  "appeal.note_added": "activity.noteAdded",
  "appeal.letter_saved": "activity.letterSaved",
  "appeal.letter_attested": "activity.letterAttested",
  "appeal.letter_exported": "activity.letterExported",
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
  const t = await getT("appeals");
  const tc = await getT("common");
  const f = await getFormat();

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
    const letter = await getLetterSummary(tx, id);
    return { ...row, letter };
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
      <nav aria-label={t("nav.breadcrumb")} className="text-label text-muted">
        <Link href="/appeals" className="font-medium text-link hover:underline">
          {t("queue.title")}
        </Link>{" "}
        <span aria-hidden>/</span> <span className="font-mono">{claim.claimNumber}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-6 rounded-panel border border-border bg-surface px-5 py-4 shadow-xs">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-[1.5rem] leading-8 font-bold text-primary">{claim.claimNumber}</h1>
            <Badge tone={status.tone}>{t(status.labelKey)}</Badge>
          </div>
          <p className="mt-1 text-body text-muted">
            {t("detail.subtitle", { level: t(APPEAL_LEVEL_LABEL_KEYS[appeal.level]), payer: payer.name })}{" "}
            <Link href={`/denials/${denial.id}`} className="font-medium text-link hover:underline">
              {t("action.viewDenial")}
            </Link>
          </p>
        </div>
      </header>
      {!canWork && (
        <p
          role="note"
          className="rounded-control border border-info-border bg-info-bg px-3 py-2 text-body text-info-fg"
        >
          {t("detail.readOnlyNotice")}
        </p>
      )}

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] items-start gap-6">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title={t("panel.denial")}>
            <dl className="grid grid-cols-3 gap-x-6 gap-y-4">
              <div className="col-span-3 flex flex-col gap-1">
                <dt className="text-label font-medium text-muted">{tc("word.reason")}</dt>
                <dd className="flex items-start gap-2 text-body text-text">
                  <Code>CARC {denial.carc}</Code>
                  <span>{carc?.summary ?? t("detail.carcUnknown")}</span>
                </dd>
              </div>
              <Field label={tc("word.category")}>{tc(CATEGORY_LABEL_KEYS[denial.category])}</Field>
              <Field label={t("field.deniedAmount")}>
                <Money cents={denial.deniedCents} className="font-semibold" />
              </Field>
              <Field label={t("field.appliesTo")}>
                {deniedLine
                  ? t("field.line", { number: deniedLine.lineNumber, code: deniedLine.procedureCode })
                  : t("field.wholeClaim")}
              </Field>
            </dl>
          </Panel>

          <Panel title={t("letter.panel.title")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {detail.letter.version === null ? (
                <p className="text-body text-muted">{t("letter.panel.none")}</p>
              ) : (
                <p className="flex items-center gap-2 text-body text-text">
                  {t("letter.panel.version", { version: detail.letter.version })}
                  <Badge tone={detail.letter.attested ? "success" : "warning"}>
                    {detail.letter.attested ? t("letter.panel.reviewed") : t("letter.panel.notReviewed")}
                  </Badge>
                </p>
              )}
              <Link href={`/appeals/${appeal.id}/letter`} className={secondaryLinkButtonClass}>
                {canWork ? t("letter.panel.open") : t("letter.panel.view")}
              </Link>
            </div>
          </Panel>

          {canSubmit && (
            <Panel title={t("panel.recordSubmission")}>
              <SubmissionForm appealId={appeal.id} today={today} disabled={!canSubmit} />
            </Panel>
          )}

          {appeal.submittedOn && (
            <Panel title={t("panel.submission")}>
              <dl className="grid grid-cols-3 gap-x-6 gap-y-4">
                <Field label={t("field.method")}>
                  {appeal.submittedMethod
                    ? t(APPEAL_SUBMITTED_METHOD_LABEL_KEYS[appeal.submittedMethod])
                    : "—"}
                </Field>
                <Field label={t("field.submitted")}>
                  <span className="tabular">{f.date(appeal.submittedOn)}</span>{" "}
                  {submissionTimeliness(appeal.submittedOn, appeal.deadline) === "on_time" ? (
                    <Badge tone="success">{t("badge.onTime")}</Badge>
                  ) : submissionTimeliness(appeal.submittedOn, appeal.deadline) === "late" ? (
                    <Badge tone="danger">{t("badge.late")}</Badge>
                  ) : null}
                </Field>
                <Field label={t("field.trackingReference")}>{appeal.trackingReference ?? "—"}</Field>
                <Field label={t("field.followUp")}>
                  {appeal.followUpOn ? <span className="tabular">{f.date(appeal.followUpOn)}</span> : "—"}
                </Field>
              </dl>
            </Panel>
          )}

          {canDecide && (
            <Panel title={t("panel.recordDecision")}>
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
            <Panel title={t("panel.decision")}>
              <dl className="grid grid-cols-3 gap-x-6 gap-y-4">
                <Field label={t("field.outcome")}>
                  {t(APPEAL_DECISION_OUTCOME_LABEL_KEYS[appeal.decisionOutcome])}
                </Field>
                <Field label={t("field.decided")}>
                  {appeal.decisionOn ? <span className="tabular">{f.date(appeal.decisionOn)}</span> : "—"}
                </Field>
                <Field label={t("field.recovered")}>
                  {appeal.recoveredCents !== null ? <Money cents={appeal.recoveredCents} /> : "—"}
                </Field>
                {appeal.closeReason && (
                  <div className="col-span-3">
                    <Field label={tc("word.reason")}>{appeal.closeReason}</Field>
                  </div>
                )}
              </dl>
            </Panel>
          )}

          <Panel title={t("panel.notesTitle")} description={t("panel.notesDescription")}>
            <div className="flex flex-col gap-5">
              <AppealNoteForm appealId={appeal.id} disabled={!canWork} />
              {detail.notes.length === 0 ? (
                <p className="text-body text-muted">{t("notesEmpty")}</p>
              ) : (
                <ol className="flex flex-col divide-y divide-border border-t border-border">
                  {detail.notes.map((note) => (
                    <li key={note.id} className="py-3">
                      <p className="text-label text-muted">
                        <span className="font-medium text-text">{note.author}</span> ·{" "}
                        {f.dateTime(note.createdAt)}
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
          <Panel title={t("panel.deadline")}>
            {appeal.deadline ? (
              <div className="flex flex-col gap-3">
                {status.awaitingAction ? (
                  <DeadlineIndicator
                    dueDate={appeal.deadline}
                    daysRemaining={daysUntil(appeal.deadline, today)}
                    dueSoonDays={DUE_SOON_DAYS}
                  />
                ) : (
                  <span className="tabular text-body">{f.date(appeal.deadline)}</span>
                )}
                <p className="text-label text-muted">
                  {appeal.deadlineBasis === "payer_contract"
                    ? t("deadline.fromContract", {
                        days: payer.appealWindowDays ?? 0,
                        source: payer.appealWindowSource ? ` (${payer.appealWindowSource})` : "",
                      })
                    : appeal.deadlineCitation}
                </p>
              </div>
            ) : (
              <p className="text-body text-warning-fg">
                {t("deadline.notConfigured", { payer: payer.name })}
              </p>
            )}
          </Panel>

          <Panel title={t("panel.claimAndPatient")}>
            <dl className="flex flex-col gap-3">
              <Field label={tc("word.claim")}>
                <Link
                  href={`/denials/${denial.id}`}
                  className="font-mono font-medium text-link hover:underline"
                >
                  {claim.claimNumber}
                </Link>
              </Field>
              <Field label={t("field.billed")}>
                <Money cents={claim.billedCents} />
              </Field>
              <Field label={tc("word.patient")}>
                <Link href={`/patients/${patient.id}`} className="font-medium text-link hover:underline">
                  {patient.lastName}, {patient.firstName}
                </Link>
              </Field>
              <Field label={t("field.mrn")}>
                <span className="font-mono">{patient.mrn}</span>
              </Field>
              <Field label={t("field.memberId")}>
                {!patient.memberIdLast4 ? (
                  <span className="text-subtle">{t("field.memberIdNone")}</span>
                ) : canWork ? (
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

          <Panel title={t("panel.activity")}>
            {detail.activity.length === 0 ? (
              <p className="text-body text-muted">{t("activityEmpty")}</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {detail.activity.map((event) => (
                  <li key={event.id} className="text-body">
                    <p className="text-text">
                      <span className="font-medium">{event.actor ?? t("activity.actorSystem")}</span>{" "}
                      {ACTIVITY_KEYS[event.action] ? t(ACTIVITY_KEYS[event.action]!) : event.action}
                    </p>
                    <p className="text-label text-muted">{f.dateTime(event.occurredAt)}</p>
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
