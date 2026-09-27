import type { Metadata } from "next";
import Link from "next/link";
import { todayIn } from "@rules/calendar";
import { canEditPatients } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { payerOptions } from "@/domain/denials/queries";
import { activeCustomFields } from "@/domain/settings/queries";
import { getT } from "@/i18n/server";
import { syntheticDataOnly } from "@/lib/env";
import { toCustomFieldOptions } from "@/components/custom-fields/options";
import { PatientForm } from "../PatientForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("patients");
  return { title: t("new.title") };
}

export default async function NewPatientPage() {
  const auth = await requireAuth();
  const t = await getT("patients");
  if (!canEditPatients(auth.role)) {
    return (
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
        <PageHeader title={t("new.title")} />
        <p role="note" className="text-body text-muted">
          {t("new.readOnlyNotice")}{" "}
          <Link href="/patients" className="font-medium text-link hover:underline">
            {t("new.backToPatients")}
          </Link>
        </p>
      </div>
    );
  }
  const { payers, customFields } = await withTenant(auth, async (tx) => ({
    payers: await payerOptions(tx),
    customFields: await activeCustomFields(tx, "patient"),
  }));

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <nav aria-label={t("nav.breadcrumb")} className="text-label text-muted">
        <Link href="/patients" className="font-medium text-link hover:underline">
          {t("list.title")}
        </Link>{" "}
        <span aria-hidden>/</span> {t("nav.register")}
      </nav>
      <PageHeader title={t("new.title")} description={t("new.description")} />
      <Panel>
        <PatientForm
          payers={payers}
          syntheticOnly={syntheticDataOnly()}
          today={todayIn()}
          customFields={toCustomFieldOptions(customFields)}
        />
      </Panel>
    </div>
  );
}
