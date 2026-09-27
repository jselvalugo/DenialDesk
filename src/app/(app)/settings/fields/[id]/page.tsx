import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { canConfigureSettings } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Panel } from "@/components/ui/Panel";
import { customFields } from "@/db/schema";
import { withTenant } from "@/db/tenant";
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
    <Panel title={t("fields.editTitle", { label: field.label })} description={t("fields.editDescription")}>
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
          updatedAt: field.updatedAt.toISOString(),
        }}
      />
    </Panel>
  );
}
