import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { canCorrectClaims, canGenerateClaimFile } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { CustomFieldValues } from "@/components/custom-fields/CustomFieldValues";
import { Field, FieldList } from "@/components/records/FieldList";
import { RecordHeader } from "@/components/records/RecordHeader";
import { RecordLayout } from "@/components/records/RecordLayout";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { DeadlineIndicator } from "@/components/ui/DeadlineIndicator";
import { Money } from "@/components/ui/Money";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { CATEGORY_LABEL_KEYS } from "@/domain/carc";
import { diffSnapshots } from "@/domain/claims/correction";
import { getClaim } from "@/domain/claims/queries";
import { CHARGE_IMPORT_REASON } from "@/domain/claims/versions";
import { claimPayments } from "@/domain/remittances/queries";
import { REMITTANCE_STATUSES } from "@/domain/remittances/status";
import { CLAIM_STATUSES, FILING_WARNING_DAYS, filingStatus, isUnsubmitted } from "@/domain/claims/status";
import { DENIAL_STATUSES, regimeLabel } from "@/domain/denial-status";
import { loadValuesForRecord } from "@/domain/custom-fields/values";
import { getFormat, getT } from "@/i18n/server";
import { audit } from "@/lib/audit";
import { Claim837Form } from "./Claim837Form";
import { CorrectionAction, CorrectionForm, CorrectionProvider } from "./CorrectionForm";
import { revealClaimCustomField } from "./actions";

// The title never includes patient data (DESIGN.md §12).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("claims");
  return { title: t("detail.pageTitle") };
}

export default async function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();
  const today = todayIn();
  const t = await getT("claims");
  const tc = await getT("common");
  const tr = await getT("remittances");
  const tcf = await getT("customFields");
  const f = await getFormat();

  const detail = await withTenant(auth, async (tx) => {
    const detail = await getClaim(tx, id);
    if (!detail) return null;
    const payments = await claimPayments(tx, id);
    await audit(tx, {
      action: "claim.viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "claim",
      entityId: id,
      // Whose record was shown, for accounting of disclosures (IDs only).
      metadata: { patientId: detail.patient.id },
    });
    const customValues = await loadValuesForRecord(
      tx,
      { tenantId: auth.tenantId, userId: auth.userId, role: auth.role },
      "claim",
      id,
    );
    return { ...detail, payments, customValues };
  });
  if (!detail) notFound();

  const { claim, patient, payer, customValues } = detail;
  const status = CLAIM_STATUSES[claim.status];
  const unsubmitted = isUnsubmitted(claim.status);
  const filing = filingStatus(payer.regime, claim.serviceDate, today);
  // Sent but not yet confirmed received (999/277CA capture is phase C4): the window still matters, since
  // the claim is timely if submitted by the deadline, evidenced by the clearinghouse acknowledgement.
  const awaitingReceipt = claim.status === "submitted" && !claim.payerReceivedDate;
  const showDeadline = unsubmitted || awaitingReceipt;
  const canCorrect = canCorrectClaims(auth.role) && unsubmitted;
  // The 837P carries the member ID, so it is offered to the people who bill, for a claim not yet accepted.
  const canGenerateFile = canGenerateClaimFile(auth.role) && unsubmitted;
  const snapshots = new Map(detail.history.map((v) => [v.version, v.snapshot]));

  const body = (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <Breadcrumbs
        label={t("nav.breadcrumb")}
        items={[
          { label: t("detail.breadcrumbClaims"), href: "/claims" },
          { label: claim.claimNumber, mono: true },
        ]}
      />

      <RecordHeader
        eyebrow={t("detail.eyebrow")}
        title={claim.claimNumber}
        titleStyle="mono"
        badges={<Badge tone={status.tone}>{tc(status.labelKey)}</Badge>}
        meta={[
          {
            label: tc("word.patient"),
            value: (
              <Link href={`/patients/${patient.id}`} className="font-medium text-link hover:underline">
                {patient.lastName}, {patient.firstName}
              </Link>
            ),
          },
          { label: t("detail.field.payer"), value: payer.name },
          { label: t("detail.field.dateOfService"), value: f.date(claim.serviceDate), tabular: true },
          { label: t("detail.field.version"), value: claim.version, tabular: true },
          { label: t("detail.field.billed"), value: <Money cents={claim.billedCents} /> },
          { label: t("detail.field.paid"), value: <Money cents={claim.paidCents} /> },
        ]}
        actions={canCorrect && <CorrectionAction />}
      />

      <RecordLayout
        aside={
          <>
            <Panel title={t("detail.details.title")}>
              <FieldList columns={2}>
                <Field label={t("detail.field.provider")}>
                  {detail.providerName}
                  <span className="block font-mono text-label text-muted">
                    {t("detail.field.npi", { npi: detail.providerNpi })}
                  </span>
                </Field>
                <Field label={t("detail.field.location")}>{detail.locationName}</Field>
                <Field label={t("detail.field.payer")}>
                  {payer.name}
                  <span className="block text-label text-muted">{regimeLabel(payer.regime, tc)}</span>
                </Field>
                <Field label={t("detail.field.payerReceived")} tabular empty="—">
                  {claim.payerReceivedDate ? f.date(claim.payerReceivedDate) : null}
                </Field>
                <Field label={t("detail.field.diagnosis")} span>
                  <span className="flex flex-wrap gap-1">
                    {claim.diagnosisCodes.map((code) => (
                      <Code key={code}>{code}</Code>
                    ))}
                  </span>
                </Field>
              </FieldList>
            </Panel>

            <Panel title={t("detail.filing.title")}>
              {!showDeadline ? (
                <p className="text-body text-muted">
                  {claim.payerReceivedDate
                    ? t("detail.filing.receivedNoLongerApplies", { date: f.date(claim.payerReceivedDate) })
                    : t("detail.filing.acceptedNoLongerApplies")}
                </p>
              ) : filing.deadline && filing.daysRemaining !== null ? (
                <div className="flex flex-col gap-3">
                  {awaitingReceipt && (
                    <p className="text-body text-text">{t("detail.filing.awaitingReceipt")}</p>
                  )}
                  <DeadlineIndicator
                    dueDate={filing.deadline.date}
                    daysRemaining={filing.daysRemaining}
                    dueSoonDays={FILING_WARNING_DAYS}
                  />
                  {filing.deadline.rolledDate && (
                    <p className="text-label text-muted">
                      {t("detail.filing.rolledNote", { date: f.date(filing.deadline.rolledDate) })}
                    </p>
                  )}
                  {filing.state === "past_deadline" && (
                    <p className="text-body text-danger-fg">{t("detail.filing.pastDeadlineWarning")}</p>
                  )}
                  <p className="text-label text-muted">
                    {t("detail.filing.fromServiceDate", { citation: filing.deadline.citation })}
                  </p>
                  {filing.deadline.verify && (
                    <Badge tone="warning">{t("detail.filing.pendingVerification")}</Badge>
                  )}
                </div>
              ) : filing.state === "payer_unverified" ? (
                <p className="text-body text-warning-fg">{t("detail.filing.payerUnverified")}</p>
              ) : (
                <p className="text-body text-warning-fg">
                  {t("detail.filing.notConfigured", { regime: regimeLabel(payer.regime, tc) })}
                </p>
              )}
            </Panel>

            <Panel title={t("detail.patient.title")}>
              <FieldList>
                <Field label={tc("word.name")}>
                  <Link href={`/patients/${patient.id}`} className="font-medium text-link hover:underline">
                    {patient.lastName}, {patient.firstName}
                  </Link>
                </Field>
                <Field label={t("detail.patient.dob")} tabular>
                  {f.date(patient.birthDate)}
                </Field>
                <Field label={t("detail.patient.mrn")} mono>
                  {patient.mrn}
                </Field>
                <Field label={t("detail.patient.memberId")}>
                  {patient.memberIdLast4 ? (
                    <span className="font-mono">•••• {patient.memberIdLast4}</span>
                  ) : (
                    <span className="text-subtle">{t("detail.patient.memberIdNone")}</span>
                  )}
                </Field>
              </FieldList>
            </Panel>

            <Panel title={t("detail.denials.title")}>
              {detail.denials.length === 0 ? (
                <p className="text-body text-muted">{t("detail.denials.none")}</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {detail.denials.map((denial) => (
                    <li key={denial.id} className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <Link
                          href={`/denials/${denial.id}`}
                          className="font-medium text-link hover:underline"
                        >
                          {tc(CATEGORY_LABEL_KEYS[denial.category])}
                        </Link>
                        <span className="block text-label text-muted">
                          {denial.groupCode}-{denial.carc} ·{" "}
                          {t("detail.denials.notice", { date: f.date(denial.noticeDate) })}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <Money cents={denial.deniedCents} className="block" />
                        <Badge tone={DENIAL_STATUSES[denial.status].tone}>
                          {tc(DENIAL_STATUSES[denial.status].labelKey)}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        }
      >
        <Panel title={t("detail.lines.title")} flush>
          <Table caption={t("detail.table.claimLinesCaption")}>
            <thead>
              <tr>
                <Th>{t("detail.table.line")}</Th>
                <Th>{t("detail.table.procedure")}</Th>
                <Th>{t("detail.table.modifiers")}</Th>
                <Th numeric>{t("detail.table.units")}</Th>
                <Th numeric>{t("detail.table.charge")}</Th>
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
              {t("detail.readOnlyNote")}
            </p>
          )}
        </Panel>

        {canGenerateFile && (
          <Panel title={t("edi.title")} description={t("edi.description")} flush>
            <Claim837Form
              claimId={claim.id}
              diagnosisCodes={claim.diagnosisCodes}
              lines={detail.lines.map((l) => ({ lineNumber: l.lineNumber, procedureCode: l.procedureCode }))}
            />
          </Panel>
        )}

        <Panel title={t("detail.payments.title")}>
          {detail.payments.length === 0 ? (
            <p className="text-body text-muted">{t("detail.payments.none")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {detail.payments.map((payment) => (
                <li key={payment.remittanceId} className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <Link
                      href={`/remittances/${payment.remittanceId}`}
                      className="font-mono font-medium text-link hover:underline"
                    >
                      {payment.traceNumber}
                    </Link>
                    <span className="block text-label text-muted">
                      {t("detail.payments.paidOn", { date: f.date(payment.paymentDate) })}
                      {payment.adjustments.length > 0 &&
                        ` · ${payment.adjustments.map((a) => `${a.group}-${a.carc}`).join(", ")}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <Money cents={payment.paidCents} className="block" />
                    <Badge tone={REMITTANCE_STATUSES[payment.status].tone}>
                      {tr(REMITTANCE_STATUSES[payment.status].labelKey)}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {claim.payerReceivedDate && (
            <p className="mt-3 border-t border-border pt-3 text-label">
              <Link href={`/prompt-pay/${claim.id}`} className="font-medium text-link hover:underline">
                {t("detail.payments.promptPayLink")}
              </Link>
            </p>
          )}
        </Panel>

        <Panel title={t("detail.history.title")} description={t("detail.history.description")}>
          <ol className="flex flex-col divide-y divide-border" aria-label={t("detail.history.listLabel")}>
            {detail.history.map((entry) => {
              const previous = snapshots.get(entry.version - 1);
              const changes = previous ? diffSnapshots(previous, entry.snapshot, t, tc) : [];
              return (
                <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-label text-muted">
                    <span className="font-medium text-text">
                      {t("detail.history.version", { version: entry.version })}
                    </span>{" "}
                    ·{" "}
                    {entry.author ??
                      (entry.changedBy
                        ? t("detail.history.formerTeamMember")
                        : t("detail.history.system"))}{" "}
                    · {f.dateTime(entry.createdAt)}
                  </p>
                  <p className="mt-1 text-body whitespace-pre-wrap text-text">
                    {entry.version === 1 && entry.reason === CHARGE_IMPORT_REASON
                      ? t("detail.history.createdByImport")
                      : entry.reason}
                  </p>
                  {changes.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1 text-label">
                      {changes.map((change) => (
                        <li key={change.label}>
                          <span className="font-medium text-text">{change.label}</span>:{" "}
                          <span className="font-mono text-muted line-through">{change.from}</span>{" "}
                          <span aria-hidden>→</span>
                          <span className="sr-only">{t("detail.history.changedTo")}</span>{" "}
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

        {customValues.length > 0 && (
          <Panel
            title={tcf("section.title")}
            actions={
              canCorrectClaims(auth.role) && (
                <Link
                  href={`/claims/${claim.id}/fields`}
                  className="text-label font-medium text-link hover:underline"
                >
                  {t("detail.editCustomFields")}
                </Link>
              )
            }
          >
            <CustomFieldValues values={customValues} reveal={revealClaimCustomField.bind(null, claim.id)} />
          </Panel>
        )}
      </RecordLayout>
    </div>
  );

  return canCorrect ? <CorrectionProvider>{body}</CorrectionProvider> : body;
}
