import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { canEditPayerFields, canWorkDenials } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { CustomFieldsEditForm } from "@/components/custom-fields/CustomFieldsEditForm";
import { toCustomFieldOptions } from "@/components/custom-fields/options";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { payers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { customFieldValuesToken, loadValuesForRecord } from "@/domain/custom-fields/values";
import { activeCustomFields } from "@/domain/settings/queries";
import { getT } from "@/i18n/server";
import { savePayerCustomFields } from "./actions";

// The title never includes patient data (DESIGN.md §12) — payers carry none, but the pattern is
// kept for consistency with the other "edit custom fields" pages.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("payers.fieldsMetaTitle") };
}

export default async function PayerCustomFieldsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();
  if (!canEditPayerFields(auth.role)) redirect(`/settings/payers/${id}`);
  const t = await getT("settings");

  // Loads only what this page shows: the payer's name (for the breadcrumb) and its active custom
  // fields and values — never the rest of the payer record.
  const data = await withTenant(auth, async (tx) => {
    const [payer] = await tx.select({ name: payers.name }).from(payers).where(eq(payers.id, id)).limit(1);
    if (!payer) return null;
    const fields = await activeCustomFields(tx, "payer");
    if (fields.length === 0) return { name: payer.name, fields, values: [], token: "" };
    const values = await loadValuesForRecord(
      tx,
      { tenantId: auth.tenantId, userId: auth.userId, role: auth.role },
      "payer",
      id,
    );
    const token = await customFieldValuesToken(tx, "payer", id);
    return { name: payer.name, fields, values, token };
  });
  if (!data) notFound();
  // Nothing to edit: send them back rather than showing an empty form.
  if (data.fields.length === 0) redirect(`/settings/payers/${id}`);

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-6">
      <Breadcrumbs
        label={t("nav.breadcrumb")}
        items={[
          { label: t("payers.breadcrumbList"), href: "/settings/payers" },
          { label: data.name, href: `/settings/payers/${id}` },
          { label: t("payers.fieldsBreadcrumb") },
        ]}
      />
      <PageHeader title={t("payers.fieldsPageTitle")} description={t("payers.fieldsDescription")} />
      <Panel flush>
        <CustomFieldsEditForm
          action={savePayerCustomFields}
          recordIdName="payerId"
          recordId={id}
          expectedValuesToken={data.token}
          fields={toCustomFieldOptions(data.fields)}
          values={data.values}
          cancelHref={`/settings/payers/${id}`}
          canChangeLocked={canWorkDenials(auth.role)}
        />
      </Panel>
    </div>
  );
}
