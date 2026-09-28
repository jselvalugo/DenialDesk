import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canConfigureSettings } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Panel } from "@/components/ui/Panel";
import { customFieldEntityLabel } from "@/domain/settings/custom-fields";
import { getT } from "@/i18n/server";
import { CustomFieldForm } from "../CustomFieldForm";
import { recordsParam } from "../records";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("fields.newMetaTitle") };
}

export default async function NewCustomFieldPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  if (!canConfigureSettings(auth.role)) notFound();
  const t = await getT("settings");
  const entity = recordsParam((await searchParams).records);
  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        label={t("fields.recordTypesLabel")}
        items={[
          { label: customFieldEntityLabel(entity, t), href: `/settings/fields?records=${entity}` },
          { label: t("fields.newTitle") },
        ]}
      />
      <Panel flush>
        <CustomFieldForm entity={entity} />
      </Panel>
    </div>
  );
}
