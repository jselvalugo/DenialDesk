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
import { blocksPatientsRegister } from "@/domain/integrations/connections";
import { loadPatientsConnectionSummary } from "@/components/shell/connection-summary";
import { activeCustomFields } from "@/domain/settings/queries";
import { getT } from "@/i18n/server";
import { toCustomFieldOptions } from "@/components/custom-fields/options";
import { syntheticDataOnly } from "@/lib/env";
import { PatientForm } from "../PatientForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("patients");
  return { title: t("new.title") };
}

export default async function NewPatientPage() {
  const auth = await requireAuth();
  const t = await getT("patients");
  // Request-memoized (React `cache()`), shared with the layout's own load of this summary
  // (security/correctness review PR #81, item 18).
  const connectionSummary = await loadPatientsConnectionSummary();
  const registerBlocked = blocksPatientsRegister(connectionSummary);
  const canEditRole = canEditPatients(auth.role);

  // A read-only viewer (by role, or because a live connection blocks hand-registering) never
  // reaches the form below, so don't spend a query loading payer options or custom-field
  // definitions they'll never see (item 18).
  if (!canEditRole || registerBlocked) {
    return (
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
        <PageHeader title={t("new.title")} />
        <p role="note" className="text-body text-muted">
          {registerBlocked && connectionSummary
            ? connectionSummary.status === "active"
              ? t("notice.syncedFromConnection", { name: connectionSummary.displayName })
              : t("notice.connectionBeingSetUp", { name: connectionSummary.displayName })
            : t("new.readOnlyNotice")}{" "}
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
      <Breadcrumbs
        label={t("nav.breadcrumb")}
        items={[{ label: t("list.title"), href: "/patients" }, { label: t("nav.register") }]}
      />
      <PageHeader title={t("new.title")} description={t("new.description")} />
      <Panel flush>
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
