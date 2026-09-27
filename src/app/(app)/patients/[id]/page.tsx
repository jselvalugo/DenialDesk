import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { canEditPatients, canTagSensitivity, canWorkDenials } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { MaskedMemberId } from "@/components/patients/MaskedMemberId";
import { Field, FieldList } from "@/components/records/FieldList";
import { RecordHeader } from "@/components/records/RecordHeader";
import { RecordLayout } from "@/components/records/RecordLayout";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { secondaryLinkButtonClass } from "@/components/ui/linkButton";
import { Money } from "@/components/ui/Money";
import { Panel } from "@/components/ui/Panel";
import { StatTile } from "@/components/ui/StatTile";
import { withTenant } from "@/db/tenant";
import { CATEGORY_LABEL_KEYS } from "@/domain/carc";
import { CLAIM_STATUSES } from "@/domain/claims/status";
import { DENIAL_STATUSES, regimeLabel } from "@/domain/denial-status";
import { getPatientChart } from "@/domain/patients/queries";
import {
  ageOn,
  patientName,
  sensitivityTagLabel,
  sexLabel,
  type SensitivityTag,
} from "@/domain/patients/record";
import { loadValuesForRecord } from "@/domain/custom-fields/values";
import { CustomFieldValues } from "@/components/custom-fields/CustomFieldValues";
import { getFormat, getT } from "@/i18n/server";
import { audit } from "@/lib/audit";
import { formatCents } from "@/lib/format";
import { revealCustomField, revealPatientMemberId } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const tc = await getT("common");
  // The title never includes patient data (DESIGN.md §12).
  return { title: tc("word.patient") };
}

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();
  const t = await getT("patients");
  const tc = await getT("common");
  const tcf = await getT("customFields");
  const f = await getFormat();

  const chart = await withTenant(auth, async (tx) => {
    const chart = await getPatientChart(tx, id);
    if (!chart) return null;
    await audit(tx, {
      action: "patient.viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "patient",
      entityId: id,
      metadata: { claims: chart.claims.length, denials: chart.denials.length },
    });
    return chart;
  });
  if (!chart) notFound();
  const customValues = await withTenant(auth, (tx) =>
    loadValuesForRecord(tx, { tenantId: auth.tenantId, userId: auth.userId, role: auth.role }, "patient", id),
  );

  const { patient, payer, totals } = chart;
  const age = ageOn(patient.birthDate, todayIn());
  const address = [
    patient.addressLine1,
    patient.city,
    [patient.state, patient.postalCode].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  const canEdit = canEditPatients(auth.role);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <Breadcrumbs
        label={t("nav.breadcrumb")}
        items={[
          { label: t("list.title"), href: "/patients" },
          { label: patient.mrn, mono: true },
        ]}
      />

      <RecordHeader
        eyebrow={t("detail.eyebrow")}
        title={patientName(patient)}
        badges={
          // Tag names reveal a sensitive category, so only administrators see them (R-3.5.1).
          canTagSensitivity(auth.role)
            ? patient.sensitivityTags.map((tag) => (
                <Badge key={tag} tone="warning">
                  {sensitivityTagLabel(tag as SensitivityTag, t)}
                </Badge>
              ))
            : patient.sensitivityTags.length > 0 && <Badge tone="warning">{t("badge.restricted")}</Badge>
        }
        meta={[
          { label: t("field.mrn"), value: patient.mrn, mono: true },
          {
            label: t("field.birthDate"),
            value:
              age === null
                ? f.date(patient.birthDate)
                : `${f.date(patient.birthDate)} · ${t("field.age", { years: age })}`,
            tabular: true,
          },
          { label: t("field.sex"), value: sexLabel(patient.sex, t) },
          { label: t("field.coverage"), value: payer?.name ?? t("badge.selfPay") },
        ]}
        actions={
          canEdit && (
            <Link href={`/patients/${patient.id}/edit`} className={secondaryLinkButtonClass}>
              {t("detail.editRecord")}
            </Link>
          )
        }
      />

      <section aria-label={t("detail.totalsLabel")} className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile label={t("detail.claims")} value={f.number(totals.claims)} />
        <StatTile label={t("detail.billed")} value={formatCents(totals.billedCents)} />
        <StatTile label={t("detail.paid")} value={formatCents(totals.paidCents)} />
        <StatTile
          label={t("detail.openDenied")}
          value={formatCents(totals.openDeniedCents)}
          emphasis={totals.openDenials > 0 ? "warning" : undefined}
          detail={t("detail.openDenialsCount", { count: totals.openDenials })}
        />
      </section>

      <RecordLayout
        aside={
          <>
            <Panel title={t("detail.demographics")}>
              <FieldList columns={2}>
                <Field label={t("field.lastName")}>{patient.lastName}</Field>
                <Field label={t("field.firstName")}>{patient.firstName}</Field>
                <Field label={t("field.birthDate")} tabular>
                  {f.date(patient.birthDate)}
                </Field>
                <Field label={t("field.sex")}>{sexLabel(patient.sex, t)}</Field>
                <Field label={t("field.address")} empty={t("detail.notOnFile")} span>
                  {address}
                </Field>
                <Field label={t("field.phone")} empty={t("detail.notOnFile")} tabular>
                  {patient.phone}
                </Field>
              </FieldList>
            </Panel>

            <Panel title={t("detail.primaryInsurance")}>
              {payer ? (
                <FieldList>
                  <Field label={tc("word.payer")}>
                    {payer.name}
                    <span className="block text-label text-muted">{regimeLabel(payer.regime, tc)}</span>
                  </Field>
                  <Field label={t("field.memberId")} empty={t("detail.notOnFile")}>
                    {!patient.memberIdLast4 ? null : canWorkDenials(auth.role) ? (
                      <MaskedMemberId
                        last4={patient.memberIdLast4}
                        reveal={revealPatientMemberId.bind(null, patient.id)}
                      />
                    ) : (
                      <span className="font-mono">•••• {patient.memberIdLast4}</span>
                    )}
                  </Field>
                </FieldList>
              ) : (
                <p className="text-body text-muted">{t("detail.noInsurance")}</p>
              )}
            </Panel>

            {customValues.length > 0 && (
              <Panel title={tcf("section.title")}>
                <CustomFieldValues values={customValues} reveal={revealCustomField.bind(null, patient.id)} />
              </Panel>
            )}

            <Panel title={t("detail.record")} description={t("detail.recordDescription")}>
              <FieldList columns={2}>
                <Field label={t("field.mrn")}>
                  <Code>{patient.mrn}</Code>
                </Field>
                <Field label={tc("word.created")} tabular>
                  {f.dateOf(patient.createdAt)}
                </Field>
                <Field label={tc("word.updated")} tabular>
                  {f.dateOf(patient.updatedAt)}
                </Field>
              </FieldList>
            </Panel>
          </>
        }
      >
        <Panel
          title={t("detail.claims")}
          description={t("detail.claimsCount", { count: chart.claims.length })}
          flush
        >
          {chart.claims.length === 0 ? (
            <EmptyState title={t("detail.noClaimsTitle")} description={t("detail.noClaimsDescription")} />
          ) : (
            <Table caption={t("detail.claimsCaption")}>
              <thead>
                <tr>
                  <Th>{tc("word.claim")}</Th>
                  <Th>{tc("word.payer")}</Th>
                  <Th>{t("detail.dateOfService")}</Th>
                  <Th numeric>{t("detail.billed")}</Th>
                  <Th numeric>{t("detail.paid")}</Th>
                  <Th>{tc("word.status")}</Th>
                </tr>
              </thead>
              <tbody>
                {chart.claims.map((claim) => (
                  <Tr key={claim.id}>
                    <Td>
                      <Link
                        href={`/claims/${claim.id}`}
                        className="font-mono text-label font-medium whitespace-nowrap text-link hover:underline"
                      >
                        {claim.claimNumber}
                      </Link>
                    </Td>
                    <Td>{claim.payerName}</Td>
                    <Td className="tabular">{f.date(claim.serviceDate)}</Td>
                    <Td numeric>
                      <Money cents={claim.billedCents} />
                    </Td>
                    <Td numeric>
                      <Money cents={claim.paidCents} />
                    </Td>
                    <Td>
                      <Badge tone={CLAIM_STATUSES[claim.status].tone}>
                        {tc(CLAIM_STATUSES[claim.status].labelKey)}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>

        <Panel
          title={t("detail.denials")}
          description={t("detail.denialsCount", { count: chart.denials.length })}
          flush
        >
          {chart.denials.length === 0 ? (
            <EmptyState title={t("detail.noDenialsTitle")} description={t("detail.noDenialsDescription")} />
          ) : (
            <Table caption={t("detail.denialsCaption")}>
              <thead>
                <tr>
                  <Th>{tc("word.reason")}</Th>
                  <Th>{tc("word.claim")}</Th>
                  <Th>{t("detail.notice")}</Th>
                  <Th>{t("detail.appealBy")}</Th>
                  <Th numeric>{t("detail.denied")}</Th>
                  <Th>{tc("word.status")}</Th>
                </tr>
              </thead>
              <tbody>
                {chart.denials.map((denial) => (
                  <Tr key={denial.id}>
                    <Td>
                      <Link href={`/denials/${denial.id}`} className="font-medium text-link hover:underline">
                        {tc(CATEGORY_LABEL_KEYS[denial.category])}
                      </Link>
                      <span className="block font-mono text-label text-muted">
                        {denial.groupCode}-{denial.carc}
                      </span>
                    </Td>
                    <Td>
                      <Link
                        href={`/claims/${denial.claimId}`}
                        className="font-mono text-label whitespace-nowrap text-link hover:underline"
                      >
                        {denial.claimNumber}
                      </Link>
                    </Td>
                    <Td className="tabular">{f.date(denial.noticeDate)}</Td>
                    <Td className="tabular">
                      {denial.appealDeadline ? (
                        f.date(denial.appealDeadline)
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                    <Td numeric>
                      <Money cents={denial.deniedCents} />
                    </Td>
                    <Td>
                      <Badge tone={DENIAL_STATUSES[denial.status].tone}>
                        {tc(DENIAL_STATUSES[denial.status].labelKey)}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </RecordLayout>
    </div>
  );
}
