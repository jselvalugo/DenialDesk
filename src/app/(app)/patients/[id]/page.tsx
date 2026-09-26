import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { canEditPatients, canWorkDenials } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { MaskedMemberId } from "@/components/patients/MaskedMemberId";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { Panel } from "@/components/ui/Panel";
import { StatTile } from "@/components/ui/StatTile";
import { withTenant } from "@/db/tenant";
import { CATEGORY_LABELS } from "@/domain/carc";
import { CLAIM_STATUSES } from "@/domain/claims/status";
import { DENIAL_STATUSES, REGIME_LABELS } from "@/domain/denial-status";
import { getPatientChart } from "@/domain/patients/queries";
import { patientName, SENSITIVITY_TAGS, SEX_LABELS, type SensitivityTag } from "@/domain/patients/record";
import { audit } from "@/lib/audit";
import { formatCents, formatDate } from "@/lib/format";
import { revealPatientMemberId } from "../actions";

// The title never includes patient data (DESIGN.md §12).
export const metadata: Metadata = { title: "Patient" };

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
      <nav aria-label="Breadcrumb" className="text-label text-muted">
        <Link href="/patients" className="font-medium text-link hover:underline">
          Patients
        </Link>{" "}
        <span aria-hidden>/</span> <span className="font-mono">{patient.mrn}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-border pb-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-display font-bold text-primary">{patientName(patient)}</h1>
            {patient.sensitivityTags.map((tag) => (
              <Badge key={tag} tone="warning">
                {SENSITIVITY_TAGS[tag as SensitivityTag] ?? tag}
              </Badge>
            ))}
          </div>
          <p className="mt-1 text-body text-muted">
            <span className="font-mono">{patient.mrn}</span> · born {formatDate(patient.birthDate)} ·{" "}
            {payer?.name ?? "Self-pay"}
          </p>
        </div>
        {canEditPatients(auth.role) && (
          <Link href={`/patients/${patient.id}/edit`} className={editClass}>
            Edit record
          </Link>
        )}
      </header>

      <section aria-label="Patient totals" className="grid grid-cols-4 gap-4">
        <StatTile label="Claims" value={totals.claims} />
        <StatTile label="Billed" value={formatCents(totals.billedCents)} />
        <StatTile label="Paid" value={formatCents(totals.paidCents)} />
        <StatTile
          label="Open denied"
          value={formatCents(totals.openDeniedCents)}
          emphasis={totals.openDenials > 0 ? "warning" : undefined}
          detail={`${totals.openDenials} open denial${totals.openDenials === 1 ? "" : "s"}`}
        />
      </section>

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] items-start gap-6">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Claims" flush>
            {chart.claims.length === 0 ? (
              <EmptyState
                title="No claims for this patient"
                description="Claims appear here once they are created or imported for this patient."
              />
            ) : (
              <Table caption="Claims for this patient">
                <thead>
                  <tr>
                    <Th>Claim</Th>
                    <Th>Payer</Th>
                    <Th>Date of service</Th>
                    <Th numeric>Billed</Th>
                    <Th numeric>Paid</Th>
                    <Th>Status</Th>
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
                      <Td className="tabular">{formatDate(claim.serviceDate)}</Td>
                      <Td numeric>
                        <Money cents={claim.billedCents} />
                      </Td>
                      <Td numeric>
                        <Money cents={claim.paidCents} />
                      </Td>
                      <Td>
                        <Badge tone={CLAIM_STATUSES[claim.status].tone}>
                          {CLAIM_STATUSES[claim.status].label}
                        </Badge>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          <Panel title="Denials" flush>
            {chart.denials.length === 0 ? (
              <EmptyState
                title="No denials for this patient"
                description="Denials on this patient's claims appear here."
              />
            ) : (
              <Table caption="Denials for this patient">
                <thead>
                  <tr>
                    <Th>Reason</Th>
                    <Th>Claim</Th>
                    <Th>Notice</Th>
                    <Th>Appeal by</Th>
                    <Th numeric>Denied</Th>
                    <Th>Status</Th>
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
                          {CATEGORY_LABELS[denial.category]}
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
                      <Td className="tabular">{formatDate(denial.noticeDate)}</Td>
                      <Td className="tabular">
                        {denial.appealDeadline ? (
                          formatDate(denial.appealDeadline)
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Td>
                      <Td numeric>
                        <Money cents={denial.deniedCents} />
                      </Td>
                      <Td>
                        <Badge tone={DENIAL_STATUSES[denial.status].tone}>
                          {DENIAL_STATUSES[denial.status].label}
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
          <Panel title="Demographics">
            <dl className="flex flex-col gap-3">
              <Field label="Date of birth">
                <span className="tabular">{formatDate(patient.birthDate)}</span>
              </Field>
              <Field label="Sex">{SEX_LABELS[patient.sex]}</Field>
              <Field label="Address">{address || <span className="text-muted">Not on file</span>}</Field>
              <Field label="Phone">
                {patient.phone ? (
                  <span className="tabular">{patient.phone}</span>
                ) : (
                  <span className="text-muted">Not on file</span>
                )}
              </Field>
            </dl>
          </Panel>

          <Panel title="Primary insurance">
            {payer ? (
              <dl className="flex flex-col gap-3">
                <Field label="Payer">
                  {payer.name}
                  <span className="block text-label text-muted">{REGIME_LABELS[payer.regime]}</span>
                </Field>
                <Field label="Member ID">
                  {!patient.memberIdLast4 ? (
                    <span className="text-muted">Not on file</span>
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
              <p className="text-body text-muted">No insurance on file (self-pay).</p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
