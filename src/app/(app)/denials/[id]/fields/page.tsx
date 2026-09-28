import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { canWorkDenials } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { getDenial } from "@/domain/denials/queries";
import { activeCustomFields } from "@/domain/settings/queries";
import { customFieldValuesToken, loadValuesForRecord } from "@/domain/custom-fields/values";
import { toCustomFieldOptions } from "@/components/custom-fields/options";
import { CustomFieldsEditForm } from "@/components/custom-fields/CustomFieldsEditForm";
import { getT } from "@/i18n/server";
import { saveDenialCustomFields } from "./actions";

// The title never includes patient data (DESIGN.md §12).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("denials");
  return { title: t("fields.pageTitle") };
}

export default async function DenialCustomFieldsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();
  if (!canWorkDenials(auth.role)) redirect(`/denials/${id}`);
  const t = await getT("denials");

  const data = await withTenant(auth, async (tx) => {
    const detail = await getDenial(tx, id);
    if (!detail) return null;
    const fields = await activeCustomFields(tx, "denial");
    if (fields.length === 0) return { claim: detail.claim, fields, values: [], token: "" };
    const values = await loadValuesForRecord(
      tx,
      { tenantId: auth.tenantId, userId: auth.userId, role: auth.role },
      "denial",
      id,
    );
    const token = await customFieldValuesToken(tx, "denial", id);
    return { claim: detail.claim, fields, values, token };
  });
  if (!data) notFound();
  // Nothing to edit: send them back rather than showing an empty form.
  if (data.fields.length === 0) redirect(`/denials/${id}`);

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-6">
      <Breadcrumbs
        label={t("nav.breadcrumb")}
        items={[
          { label: t("detail.breadcrumb"), href: "/denials" },
          { label: data.claim.claimNumber, href: `/claims/${data.claim.id}`, mono: true },
          { label: t("fields.breadcrumb") },
        ]}
      />
      <PageHeader title={t("fields.pageTitle")} description={t("fields.description")} />
      <Panel flush>
        <CustomFieldsEditForm
          action={saveDenialCustomFields}
          recordIdName="denialId"
          recordId={id}
          expectedValuesToken={data.token}
          fields={toCustomFieldOptions(data.fields)}
          values={data.values}
          cancelHref={`/denials/${id}`}
        />
      </Panel>
    </div>
  );
}
