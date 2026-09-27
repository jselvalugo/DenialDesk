import type { Metadata } from "next";
import Link from "next/link";
import { todayIn } from "@rules/calendar";
import { canEditPatients } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { payerOptions } from "@/domain/denials/queries";
import { getT } from "@/i18n/server";
import { syntheticDataOnly } from "@/lib/env";
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
  const payers = await withTenant(auth, (tx) => payerOptions(tx));

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <Breadcrumbs
        label={t("nav.breadcrumb")}
        items={[{ label: t("list.title"), href: "/patients" }, { label: t("nav.register") }]}
      />
      <PageHeader title={t("new.title")} description={t("new.description")} />
      <Panel flush>
        <PatientForm payers={payers} syntheticOnly={syntheticDataOnly()} today={todayIn()} />
      </Panel>
    </div>
  );
}
