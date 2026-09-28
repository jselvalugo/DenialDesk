import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { canConfigureSettings } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Panel } from "@/components/ui/Panel";
import { customFields } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { customFieldEntityLabel } from "@/domain/settings/custom-fields";
import { getT } from "@/i18n/server";
import { CustomFieldForm } from "../CustomFieldForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("fields.editMetaTitle") };
}

export default async function EditCustomFieldPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!canConfigureSettings(auth.role)) notFound();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const t = await getT("settings");
  const [field] = await withTenant(auth, (tx) =>
    tx.select().from(customFields).where(eq(customFields.id, id.data)).limit(1),
  );
  if (!field) notFound();
  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        label={t("nav.breadcrumb")}
        items={[
          {
            label: customFieldEntityLabel(field.entity, t),
            href: `/settings/fields?records=${field.entity}`,
          },
          { label: field.label },
        ]}
      />
      <Panel flush>
        <CustomFieldForm
          entity={field.entity}
          field={{
            id: field.id,
            entity: field.entity,
            key: field.key,
            label: field.label,
            fieldType: field.fieldType,
            options: field.options,
            required: field.required,
            helpText: field.helpText,
            sensitivity: field.sensitivity,
            showInList: field.showInList,
            updatedAt: field.updatedAt.toISOString(),
          }}
        />
      </Panel>
    </div>
  );
}
