import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { canEditPatients } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { payerOptions } from "@/domain/denials/queries";
import { getPatientForEdit } from "@/domain/patients/queries";
import { activeCustomFields } from "@/domain/settings/queries";
import { loadValuesForRecord } from "@/domain/custom-fields/values";
import { toCustomFieldOptions } from "@/components/custom-fields/options";
import { getT } from "@/i18n/server";
import { audit } from "@/lib/audit";
import { syntheticDataOnly } from "@/lib/env";
import { PatientForm } from "../../PatientForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("patients");
  // The title never includes patient data (DESIGN.md §12).
  return { title: t("edit.title") };
}

export default async function EditPatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();
  if (!canEditPatients(auth.role)) redirect(`/patients/${id}`);
  const t = await getT("patients");

  const data = await withTenant(auth, async (tx) => {
    const patient = await getPatientForEdit(tx, id);
    if (!patient) return null;
    const payers = await payerOptions(tx);
    const customFields = await activeCustomFields(tx, "patient");
    await audit(tx, {
      action: "patient.viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "patient",
      entityId: id,
      metadata: { view: "edit" },
    });
    const customValues = await loadValuesForRecord(
      tx,
      { tenantId: auth.tenantId, userId: auth.userId, role: auth.role },
      "patient",
      id,
    );
    return { patient, payers, customFields, customValues };
  });
  if (!data) notFound();
  const { patient, payers, customFields, customValues } = data;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <Breadcrumbs
        label={t("nav.breadcrumb")}
        items={[
          { label: t("list.title"), href: "/patients" },
          { label: patient.mrn, href: `/patients/${id}`, mono: true },
          { label: t("nav.edit") },
        ]}
      />
      <PageHeader title={t("edit.title")} description={t("edit.description")} />
      <Panel flush>
        <PatientForm
          patient={{ ...patient, updatedAt: patient.updatedAt.toISOString() }}
          payers={payers}
          syntheticOnly={syntheticDataOnly()}
          today={todayIn()}
          customFields={toCustomFieldOptions(customFields)}
          customValues={customValues}
        />
      </Panel>
    </div>
  );
}
