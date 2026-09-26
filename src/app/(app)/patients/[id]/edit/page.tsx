import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { canEditPatients } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { payerOptions } from "@/domain/denials/queries";
import { getPatientForEdit } from "@/domain/patients/queries";
import { audit } from "@/lib/audit";
import { syntheticDataOnly } from "@/lib/env";
import { PatientForm } from "../../PatientForm";

// The title never includes patient data (DESIGN.md §12).
export const metadata: Metadata = { title: "Edit patient" };

export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();
  if (!canEditPatients(auth.role)) redirect(`/patients/${id}`);

  const data = await withTenant(auth, async (tx) => {
    const patient = await getPatientForEdit(tx, id);
    if (!patient) return null;
    const payers = await payerOptions(tx);
    await audit(tx, {
      action: "patient.viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "patient",
      entityId: id,
      metadata: { view: "edit" },
    });
    return { patient, payers };
  });
  if (!data) notFound();
  const { patient, payers } = data;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-label text-muted">
        <Link href="/patients" className="font-medium text-link hover:underline">
          Patients
        </Link>{" "}
        <span aria-hidden>/</span>{" "}
        <Link href={`/patients/${id}`} className="font-mono font-medium text-link hover:underline">
          {patient.mrn}
        </Link>{" "}
        <span aria-hidden>/</span> Edit
      </nav>
      <PageHeader
        title="Edit patient"
        description="Changes are saved with your reason in the audit trail. Claims already sent keep what was billed."
      />
      <Panel>
        <PatientForm
          patient={{ ...patient, updatedAt: patient.updatedAt.toISOString() }}
          payers={payers}
          syntheticOnly={syntheticDataOnly()}
          today={todayIn()}
        />
      </Panel>
    </div>
  );
}
