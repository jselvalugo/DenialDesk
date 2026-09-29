import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { canManageAppealTemplates } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Panel } from "@/components/ui/Panel";
import { denialCategoryEnum } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { MERGE_FIELDS, MERGE_FIELD_KEYS } from "@/domain/appeals/letter/merge-fields";
import { getTemplateBody } from "@/domain/appeals/letter/queries";
import { starterTemplate } from "@/domain/appeals/letter/starter-templates";
import { CATEGORY_LABEL_KEYS } from "@/domain/carc";
import { getT } from "@/i18n/server";
import { TemplateForm } from "../TemplateForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("appealTemplates.editMetaTitle") };
}

export default async function EditAppealTemplatePage({ params }: { params: Promise<{ category: string }> }) {
  // The URL holds a category name only, never PHI.
  const parsed = z.enum(denialCategoryEnum.enumValues).safeParse((await params).category);
  if (!parsed.success) notFound();
  const category = parsed.data;
  const auth = await requireAuth();
  const t = await getT("settings");
  const ta = await getT("appeals");
  const tc = await getT("common");
  const canEdit = canManageAppealTemplates(auth.role);
  const template = await withTenant(auth, (tx) => getTemplateBody(tx, category));
  const name = tc(CATEGORY_LABEL_KEYS[category]);

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        label={t("appealTemplates.breadcrumb")}
        items={[
          { label: t("appealTemplates.panelTitle"), href: "/settings/appeal-templates" },
          { label: name },
        ]}
      />
      {!canEdit && (
        <p
          role="note"
          className="rounded-control border border-info-border bg-info-bg px-3 py-2 text-body text-info-fg"
        >
          {t("appealTemplates.readOnly")}
        </p>
      )}
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] items-start gap-6 max-lg:grid-cols-1">
        <Panel
          title={t("appealTemplates.editTitle", { category: name })}
          description={template.source === "starter" ? t("appealTemplates.starterNote") : undefined}
        >
          <TemplateForm
            category={category}
            defaultBody={template.body}
            starterBody={starterTemplate(category)}
            editable={canEdit}
          />
        </Panel>
        <Panel title={t("appealTemplates.fieldsTitle")} description={ta("letter.fields.description")}>
          <ul className="flex flex-col gap-1.5">
            {MERGE_FIELD_KEYS.map((key) => (
              <li key={key} className="flex items-baseline justify-between gap-3 text-label">
                <span className="text-text">{ta(MERGE_FIELDS[key].labelKey)}</span>
                <code className="font-mono text-muted">{`{{${key}}}`}</code>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-label text-muted">{ta("letter.fields.memberIdNote")}</p>
        </Panel>
      </div>
    </div>
  );
}
