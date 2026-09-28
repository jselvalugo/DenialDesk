import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { canCorrectClaims } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { getClaim } from "@/domain/claims/queries";
import { activeCustomFields } from "@/domain/settings/queries";
import { customFieldValuesToken, loadValuesForRecord } from "@/domain/custom-fields/values";
import { toCustomFieldOptions } from "@/components/custom-fields/options";
import { CustomFieldsEditForm } from "@/components/custom-fields/CustomFieldsEditForm";
import { getT } from "@/i18n/server";
import { saveClaimCustomFields } from "./actions";

// The title never includes patient data (DESIGN.md §12).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("claims");
  return { title: t("fields.pageTitle") };
}

export default async function ClaimCustomFieldsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();
  if (!canCorrectClaims(auth.role)) redirect(`/claims/${id}`);
  const t = await getT("claims");

  const data = await withTenant(auth, async (tx) => {
    const detail = await getClaim(tx, id);
    if (!detail) return null;
    const fields = await activeCustomFields(tx, "claim");
    if (fields.length === 0) return { claimNumber: detail.claim.claimNumber, fields, values: [], token: "" };
    const values = await loadValuesForRecord(
      tx,
      { tenantId: auth.tenantId, userId: auth.userId, role: auth.role },
      "claim",
      id,
    );
    const token = await customFieldValuesToken(tx, "claim", id);
    return { claimNumber: detail.claim.claimNumber, fields, values, token };
  });
  if (!data) notFound();
  // Nothing to edit: send them back rather than showing an empty form.
  if (data.fields.length === 0) redirect(`/claims/${id}`);

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-6">
      <Breadcrumbs
        label={t("nav.breadcrumb")}
        items={[
          { label: t("detail.breadcrumbClaims"), href: "/claims" },
          { label: data.claimNumber, href: `/claims/${id}`, mono: true },
          { label: t("fields.breadcrumb") },
        ]}
      />
      <PageHeader title={t("fields.pageTitle")} description={t("fields.description")} />
      <Panel flush>
        <CustomFieldsEditForm
          action={saveClaimCustomFields}
          recordIdName="claimId"
          recordId={id}
          expectedValuesToken={data.token}
          fields={toCustomFieldOptions(data.fields)}
          values={data.values}
          cancelHref={`/claims/${id}`}
        />
      </Panel>
    </div>
  );
}
