import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { canEditPatients, canTagSensitivity, canWorkDenials } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { MaskedMemberId } from "@/components/patients/MaskedMemberId";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { Panel } from "@/components/ui/Panel";
import { StatTile } from "@/components/ui/StatTile";
import { withTenant } from "@/db/tenant";
import { CATEGORY_LABEL_KEYS } from "@/domain/carc";
import { CLAIM_STATUSES } from "@/domain/claims/status";
import { DENIAL_STATUSES, regimeLabel } from "@/domain/denial-status";
import { getPatientChart } from "@/domain/patients/queries";
import { patientName, sensitivityTagLabel, sexLabel, type SensitivityTag } from "@/domain/patients/record";
import { getFormat, getT } from "@/i18n/server";
import { audit } from "@/lib/audit";
import { formatCents } from "@/lib/format";
import { revealPatientMemberId } from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const tc = await getT("common");
  // The title never includes patient data (DESIGN.md §12).
  return { title: tc("word.patient") };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-label font-medium text-muted">{label}</dt>
      <dd className="text-body text-text">{children}</dd>
    </div>
  );
}

const editClass =
  "inline-flex h-8 items-center rounded-control border border-border-strong bg-surface px-3 text-body font-medium text-text hover:bg-surface-muted";

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();
  const t = await getT("patients");
  const tc = await getT("common");
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

  const { patient, payer, totals } = chart;
  const address = [
    patient.addressLine1,
    patient.city,
    [patient.state, patient.postalCode].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <nav aria-label={t("nav.breadcrumb")} className="text-label text-muted">
        <Link href="/patients" className="font-medium text-link hover:underline">
          {t("list.title")}
        </Link>{" "}
        <span aria-hidden>/</span> <span className="font-mono">{patient.mrn}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-border pb-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-display font-bold text-primary">{patientName(patient)}</h1>
            {/* Tag names reveal a sensitive category, so only administrators see them (R-3.5.1). */}
            {canTagSensitivity(auth.role)
              ? patient.sensitivityTags.map((tag) => (
                  <Badge key={tag} tone="warning">
                    {sensitivityTagLabel(tag as SensitivityTag, t)}
                  </Badge>
                ))
              : patient.sensitivityTags.length > 0 && <Badge tone="warning">{t("badge.restricted")}</Badge>}
          </div>
          <p className="mt-1 text-body text-muted">
            <span className="font-mono">{patient.mrn}</span> ·{" "}
            {t("detail.bornOn", { date: f.date(patient.birthDate) })} · {payer?.name ?? t("badge.selfPay")}
          </p>
        </div>
        {canEditPatients(auth.role) && (
          <Link href={`/patients/${patient.id}/edit`} className={editClass}>
            {t("detail.editRecord")}
          </Link>
        )}
      </header>

      <section aria-label={t("detail.totalsLabel")} className="grid grid-cols-4 gap-4">
        <StatTile label={t("detail.claims")} value={totals.claims} />
        <StatTile label={t("detail.billed")} value={formatCents(totals.billedCents)} />
        <StatTile label={t("detail.paid")} value={formatCents(totals.paidCents)} />
        <StatTile
          label={t("detail.openDenied")}
          value={formatCents(totals.openDeniedCents)}
          emphasis={totals.openDenials > 0 ? "warning" : undefined}
          detail={t("detail.openDenialsCount", { count: totals.openDenials })}
        />
      </section>

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] items-start gap-6">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title={t("detail.claims")} flush>
            {chart.claims.length === 0 ? (
              <EmptyState title={t("detail.noClaimsTitle")} description={t("detail.noClaimsDescription")} />
            ) : (
              <Table caption={t("detail.claims")}>
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

          <Panel title={t("detail.denials")} flush>
            {chart.denials.length === 0 ? (
              <EmptyState title={t("detail.noDenialsTitle")} description={t("detail.noDenialsDescription")} />
            ) : (
              <Table caption={t("detail.denials")}>
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
                        <Link
                          href={`/denials/${denial.id}`}
                          className="font-medium text-link hover:underline"
                        >
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
        </div>

        <div className="flex flex-col gap-6">
          <Panel title={t("detail.demographics")}>
            <dl className="flex flex-col gap-3">
              <Field label={t("field.birthDate")}>
                <span className="tabular">{f.date(patient.birthDate)}</span>
              </Field>
              <Field label={t("field.sex")}>{sexLabel(patient.sex, t)}</Field>
              <Field label={t("field.address")}>
                {address || <span className="text-muted">{t("detail.notOnFile")}</span>}
              </Field>
              <Field label={t("field.phone")}>
                {patient.phone ? (
                  <span className="tabular">{patient.phone}</span>
                ) : (
                  <span className="text-muted">{t("detail.notOnFile")}</span>
                )}
              </Field>
            </dl>
          </Panel>

          <Panel title={t("detail.primaryInsurance")}>
            {payer ? (
              <dl className="flex flex-col gap-3">
                <Field label={tc("word.payer")}>
                  {payer.name}
                  <span className="block text-label text-muted">{regimeLabel(payer.regime, tc)}</span>
                </Field>
                <Field label={t("field.memberId")}>
                  {!patient.memberIdLast4 ? (
                    <span className="text-muted">{t("detail.notOnFile")}</span>
                  ) : canWorkDenials(auth.role) ? (
                    <MaskedMemberId
                      last4={patient.memberIdLast4}
                      reveal={revealPatientMemberId.bind(null, patient.id)}
                    />
                  ) : (
                    <span className="font-mono">•••• {patient.memberIdLast4}</span>
                  )}
                </Field>
              </dl>
            ) : (
              <p className="text-body text-muted">{t("detail.noInsurance")}</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
