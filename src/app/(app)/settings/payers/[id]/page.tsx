import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { canEditPayerFields } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Panel } from "@/components/ui/Panel";
import { Field, FieldList } from "@/components/records/FieldList";
import { RecordHeader } from "@/components/records/RecordHeader";
import { RecordLayout } from "@/components/records/RecordLayout";
import { CustomFieldValues } from "@/components/custom-fields/CustomFieldValues";
import { withTenant } from "@/db/tenant";
import { regimeLabel } from "@/domain/denial-status";
import { loadValuesForRecord } from "@/domain/custom-fields/values";
import { getPayer } from "@/domain/payers/queries";
import { getFormat, getT } from "@/i18n/server";
import { revealPayerCustomField } from "./actions";

// Read-only payer record under Settings (docs/specs/settings-and-custom-fields.md S2 PR4;
// docs/specs/payer-catalog.md). Payer name, EDI payer ID, and regime are not editable here (that's
// payer-catalog P2); only the payer's own custom field values can change, via the "fields" page.
// Every practice role may view (same as the rest of Settings); no view-audit event, since payers
// carry no PHI (only patient, claim, and denial records do).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("payers.detailMetaTitle") };
}

export default async function PayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();
  const t = await getT("settings");
  const tc = await getT("common");
  const tcf = await getT("customFields");
  const f = await getFormat();

  const data = await withTenant(auth, async (tx) => {
    const payer = await getPayer(tx, id);
    if (!payer) return null;
    const customValues = await loadValuesForRecord(
      tx,
      { tenantId: auth.tenantId, userId: auth.userId, role: auth.role },
      "payer",
      id,
    );
    return { payer, customValues };
  });
  if (!data) notFound();
  const { payer, customValues } = data;
  const canEditFields = canEditPayerFields(auth.role);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <Breadcrumbs
        label={t("tabs.sectionsLabel")}
        items={[{ label: t("payers.breadcrumbList"), href: "/settings/payers" }, { label: payer.name }]}
      />

      <RecordHeader
        eyebrow={t("payers.detailEyebrow")}
        title={payer.name}
        badges={!payer.verified && <Badge tone="warning">{t("payers.badgeUnverified")}</Badge>}
        meta={[
          {
            label: t("payers.field.ediPayerId"),
            value: payer.ediPayerId ?? t("payers.notVerified"),
            mono: Boolean(payer.ediPayerId),
          },
          { label: t("payers.field.regime"), value: regimeLabel(payer.regime, tc) },
        ]}
      />

      <RecordLayout
        aside={
          <Panel title={t("payers.detailsTitle")} description={t("payers.detailsDescription")}>
            <FieldList columns={2}>
              <Field label={t("payers.field.ediPayerId")} mono empty={t("payers.notVerified")}>
                {payer.ediPayerId}
              </Field>
              <Field label={t("payers.field.regime")}>{regimeLabel(payer.regime, tc)}</Field>
              <Field label={t("payers.field.source")} span empty={t("payers.sourcePractice")}>
                {payer.source}
              </Field>
              <Field label={t("payers.field.added")} tabular>
                {f.dateOf(payer.createdAt)}
              </Field>
            </FieldList>
          </Panel>
        }
      >
        {customValues.length > 0 && (
          <Panel
            title={tcf("section.title")}
            actions={
              canEditFields && (
                <Link
                  href={`/settings/payers/${payer.id}/fields`}
                  className="text-label font-medium text-link hover:underline"
                >
                  {t("payers.editCustomFields")}
                </Link>
              )
            }
          >
            <CustomFieldValues values={customValues} reveal={revealPayerCustomField.bind(null, payer.id)} />
          </Panel>
        )}
      </RecordLayout>
    </div>
  );
}
