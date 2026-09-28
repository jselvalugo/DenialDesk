import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import {
  daysUntil,
  payerResponseStatus,
  pendingRolledDate,
  promptPayMilestones,
  rulesForBasis,
} from "@rules/deadlines";
import { canWorkDenials } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { DeadlineIndicator } from "@/components/ui/DeadlineIndicator";
import { Money } from "@/components/ui/Money";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { CARC, CATEGORY_LABEL_KEYS } from "@/domain/carc";
import { ACTION_STATUSES, DENIAL_STATUSES, regimeLabel } from "@/domain/denial-status";
import { DUE_SOON_DAYS, getDenial, teamMembers } from "@/domain/denials/queries";
import { openAppealsForDenial } from "@/domain/appeals/queries";
import { loadValuesForRecord } from "@/domain/custom-fields/values";
import { getFormat, getT } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages/types";
import { audit } from "@/lib/audit";
import { MaskedMemberId } from "@/components/patients/MaskedMemberId";
import { CustomFieldValues } from "@/components/custom-fields/CustomFieldValues";
import { revealDenialCustomField, revealMemberId } from "./actions";
import { AssignControl, NoteForm, StatusControl } from "./controls";

// The title never includes patient data (DESIGN.md §12).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("denials");
  return { title: t("detail.title") };
}

const ACTIVITY_KEYS: Record<string, MessageKey<"denials">> = {
  "denial.status_changed": "activity.statusChanged",
  "denial.assigned": "activity.assigned",
  "denial.note_added": "activity.noteAdded",
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
  const t = await getT("denials");
  const tc = await getT("common");
  const tcf = await getT("customFields");
  const f = await getFormat();

  const data = await withTenant(auth, async (tx) => {
    const detail = await getDenial(tx, id);
    if (!detail) return null;
    const team = await teamMembers(tx, auth.tenantId);
    const openAppeals = await openAppealsForDenial(tx, id);
    await audit(tx, {
      action: "denial.viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "denial",
      entityId: id,
    });
    const customValues = await loadValuesForRecord(
      tx,
      { tenantId: auth.tenantId, userId: auth.userId, role: auth.role },
      "denial",
      id,
    );
    return { detail, team, openAppeals, customValues };
  });
  if (!data) notFound();

  const { detail, team, openAppeals, customValues } = data;
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
  const appealRolled = denial.appealDeadline ? pendingRolledDate(denial.appealDeadline, basisRules) : null;
  const milestonesVerify = milestones?.some(({ rule }) => rule.verify) ?? false;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <nav aria-label={t("nav.breadcrumb")} className="text-label text-muted">
        <Link href="/denials" className="font-medium text-link hover:underline">
          {t("detail.breadcrumb")}
        </Link>{" "}
        <span aria-hidden>/</span>{" "}
        <Link href={`/claims/${claim.id}`} className="font-mono font-medium text-link hover:underline">
          {claim.claimNumber}
        </Link>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-6 rounded-panel border border-border bg-surface px-5 py-4 shadow-xs">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-[1.5rem] leading-8 font-bold text-primary">
              <Link href={`/claims/${claim.id}`} className="hover:underline">
                {claim.claimNumber}
              </Link>
            </h1>
            <Badge tone={status.tone}>{tc(status.labelKey)}</Badge>
          </div>
          <p className="mt-1 text-body text-muted">
            {t("detail.subtitle", {
              category: tc(CATEGORY_LABEL_KEYS[denial.category]),
              payer: payer.name,
              date: f.date(denial.noticeDate),
            })}
            {denial.remittanceId && (
              <>
                {" · "}
                <Link
                  href={`/remittances/${denial.remittanceId}`}
                  className="font-medium text-link hover:underline"
                >
                  {t("detail.remittanceLink")}
                </Link>{" "}
                <Badge tone="warning">{t("detail.categoryUnverifiedBadge")}</Badge>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-4">
          {canWork && openAppeals.length === 0 && ACTION_STATUSES.includes(denial.status) && (
            <Link
              href={`/appeals/new?denialId=${denial.id}`}
              className="inline-flex h-8 items-center rounded-control bg-primary px-3 text-body font-medium text-on-primary hover:opacity-90"
            >
              {t("action.startAppeal")}
            </Link>
          )}
          {openAppeals.length > 0 && (
            <Link
              href={`/appeals/${openAppeals[0]!.id}`}
              className="inline-flex h-8 items-center rounded-control border border-border-strong bg-surface px-3 text-body font-medium text-link hover:bg-surface-muted"
            >
              {t("action.viewAppeal")}
            </Link>
          )}
          <AssignControl denialId={denial.id} current={denial.assigneeId} team={team} disabled={!canWork} />
          <StatusControl
            denialId={denial.id}
            current={denial.status}
            disabled={!canWork}
            options={Object.entries(DENIAL_STATUSES).map(([value, s]) => ({ value, label: tc(s.labelKey) }))}
          />
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
                  <span>
                    {carc?.summary ?? t("detail.carcUnknown")}
                    {carc && <span className="ml-1 text-label text-subtle">{t("detail.summaryTag")}</span>}
                  </span>
                </dd>
              </div>
              <Field label={t("field.groupCode")}>
                <Code>{denial.groupCode}</Code>
              </Field>
              <Field label={t("field.remarkCodes")}>
                {denial.rarcs.length ? (
                  <span className="flex gap-1">
                    {denial.rarcs.map((r) => (
                      <Code key={r}>RARC {r}</Code>
                    ))}
                  </span>
                ) : (
                  <span className="text-subtle">{tc("word.none")}</span>
                )}
              </Field>
              <Field label={t("field.deniedAmount")}>
                <Money cents={denial.deniedCents} className="font-semibold" />
              </Field>
              <Field label={t("field.appliesTo")}>
                {deniedLine
                  ? t("field.line", { number: deniedLine.lineNumber, code: deniedLine.procedureCode })
                  : t("field.wholeClaim")}
              </Field>
              <Field label={tc("word.category")}>{tc(CATEGORY_LABEL_KEYS[denial.category])}</Field>
              <Field label={t("field.assignee")}>
                {detail.assigneeName ?? <span className="text-subtle">{t("assignee.unassigned")}</span>}
              </Field>
            </dl>
          </Panel>

          <Panel title={tc("word.claim")} flush>
            <dl className="grid grid-cols-4 gap-x-6 gap-y-4 p-4">
              <Field label={t("field.dateOfService")}>
                <span className="tabular">{f.date(claim.serviceDate)}</span>
              </Field>
              <Field label={t("field.provider")}>
                {detail.providerName}
                <span className="block font-mono text-label text-muted">
                  {t("field.npi", { npi: detail.providerNpi })}
                </span>
              </Field>
              <Field label={t("field.location")}>{detail.locationName}</Field>
              <Field label={tc("word.payer")}>
                {payer.name}
                <span className="block text-label text-muted">{regimeLabel(payer.regime, tc)}</span>
              </Field>
              <Field label={t("field.billed")}>
                <Money cents={claim.billedCents} />
              </Field>
              <Field label={t("field.paid")}>
                <Money cents={claim.paidCents} />
              </Field>
              <Field label={t("field.payerReceived")}>
                <span className="tabular">
                  {claim.payerReceivedDate ? f.date(claim.payerReceivedDate) : "—"}
                </span>
              </Field>
              <Field label={t("field.diagnosis")}>
                <span className="flex flex-wrap gap-1">
                  {claim.diagnosisCodes.map((code) => (
                    <Code key={code}>{code}</Code>
                  ))}
                </span>
              </Field>
            </dl>
            <div className="border-t border-border">
              <Table caption={t("claimLine.tableCaption")}>
                <thead>
                  <tr>
                    <Th>{t("claimLine.line")}</Th>
                    <Th>{t("claimLine.procedure")}</Th>
                    <Th>{t("claimLine.modifiers")}</Th>
                    <Th numeric>{t("claimLine.units")}</Th>
                    <Th numeric>{t("claimLine.charge")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.lines.map((line) => (
                    <Tr key={line.id} selected={line.id === denial.claimLineId}>
                      <Td className="tabular">{line.lineNumber}</Td>
                      <Td>
                        <Code>{line.procedureCode}</Code>
                        {line.id === denial.claimLineId && (
                          <span className="ml-2 text-label font-medium text-danger-fg">
                            {t("claimLine.deniedLine")}
                          </span>
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

          <Panel title={t("panel.notesTitle")} description={t("panel.notesDescription")}>
            <div className="flex flex-col gap-5">
              <NoteForm denialId={denial.id} disabled={!canWork} />
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
          <Panel title={t("field.appealDeadline")}>
            {denial.appealDeadline ? (
              <div className="flex flex-col gap-3">
                {denial.appealSubmittedOn && (
                  <p className="flex items-center gap-2 text-body text-text">
                    {t("detail.appealFiled", { date: f.date(denial.appealSubmittedOn) })}
                    {denial.appealSubmittedOn <= denial.appealDeadline ? (
                      <Badge tone="success">{t("badge.onTime")}</Badge>
                    ) : (
                      <Badge tone="danger">{t("badge.afterDeadline")}</Badge>
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
                  <span className="tabular text-body">{f.date(denial.appealDeadline)}</span>
                )}
                {appealRolled && (
                  <p className="text-label text-muted">
                    {tc("deadline.pendingCounsel", { date: f.date(appealRolled) })}
                  </p>
                )}
                <p className="text-label text-muted">
                  {denial.appealDeadlineBasis === "payer_contract"
                    ? t("deadline.fromContract", {
                        days: payer.appealWindowDays ?? 0,
                        source: payer.appealWindowSource ? ` (${payer.appealWindowSource})` : "",
                      })
                    : basisRules
                        .map((rule) =>
                          t("deadline.ruleLine", {
                            title: rule.title,
                            days: rule.value,
                            citation: rule.citation,
                          }),
                        )
                        .join(" ")}
                </p>
                {deadlineVerify && <Badge tone="warning">{t("badge.pendingVerification")}</Badge>}
              </div>
            ) : (
              <p className="text-body text-warning-fg">
                {t("deadline.notConfigured", { payer: payer.name })}
              </p>
            )}
          </Panel>

          {milestones && (
            <Panel
              title={t("promptPay.title")}
              description={t("promptPay.description", {
                received: f.date(claim.payerReceivedDate!),
                notice: f.date(denial.noticeDate),
              })}
            >
              <ol className="flex flex-col gap-3">
                {milestones.map(({ rule, date, rolledDate }) => {
                  // The denial notice is the payer's response; compare it to each obligation.
                  const response = payerResponseStatus(date, denial.noticeDate);
                  return (
                    <li key={rule.id} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-body text-text">{rule.title}</p>
                        <p className="text-label text-muted">
                          {t("promptPay.dayLine", { day: rule.value, citation: rule.citation })}
                        </p>
                      </div>
                      <span className="shrink-0 text-right">
                        <span className="tabular block text-body">{f.date(date)}</span>
                        {rolledDate && (
                          <span className="tabular block text-label text-muted">
                            {tc("deadline.pendingCounsel", { date: f.date(rolledDate) })}
                          </span>
                        )}
                        {response.met ? (
                          <span className="block text-label font-medium text-success-fg">
                            {t("promptPay.met")}
                          </span>
                        ) : (
                          <span className="tabular block text-label font-medium text-danger-fg">
                            {t("promptPay.lateBy", { count: response.daysLate })}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-4 border-t border-border pt-3 text-label text-muted">
                {t("promptPay.footer")}
                {milestonesVerify && ` ${t("promptPay.footerVerify")}`}
              </p>
            </Panel>
          )}

          <Panel title={t("panel.patient")}>
            <dl className="flex flex-col gap-3">
              <Field label={tc("word.name")}>
                <Link href={`/patients/${patient.id}`} className="font-medium text-link hover:underline">
                  {patient.lastName}, {patient.firstName}
                </Link>
              </Field>
              <Field label={t("field.dob")}>
                <span className="tabular">{f.date(patient.birthDate)}</span>
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
                    reveal={revealMemberId.bind(null, denial.id)}
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
                {detail.activity.map((event) => {
                  const toStatus =
                    event.action === "denial.status_changed" && event.metadata?.to
                      ? DENIAL_STATUSES[event.metadata.to as keyof typeof DENIAL_STATUSES]
                      : undefined;
                  const description =
                    event.action === "denial.status_changed" && event.metadata?.to
                      ? t("activity.statusChangedTo", {
                          status: toStatus ? tc(toStatus.labelKey) : String(event.metadata.to),
                        })
                      : ACTIVITY_KEYS[event.action]
                        ? t(ACTIVITY_KEYS[event.action]!)
                        : event.action;
                  return (
                    <li key={event.id} className="text-body">
                      <p className="text-text">
                        <span className="font-medium">{event.actor ?? t("activity.actorSystem")}</span>{" "}
                        {description}
                      </p>
                      <p className="text-label text-muted">{f.dateTime(event.occurredAt)}</p>
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>

          {customValues.length > 0 && (
            <Panel
              title={tcf("section.title")}
              actions={
                canWork && (
                  <Link
                    href={`/denials/${denial.id}/fields`}
                    className="text-label font-medium text-link hover:underline"
                  >
                    {t("action.editCustomFields")}
                  </Link>
                )
              }
            >
              <CustomFieldValues
                values={customValues}
                reveal={revealDenialCustomField.bind(null, denial.id)}
              />
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
