"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canManageAppealTemplates } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { denialCategoryEnum } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { MAX_LETTER_CHARS } from "@/domain/appeals/letter/merge-fields";
import { saveTemplate } from "@/domain/appeals/letter/service";
import { getT } from "@/i18n/server";

export interface TemplateActionState {
  error?: string;
  ok?: boolean;
}

const schema = z.strictObject({
  category: z.enum(denialCategoryEnum.enumValues),
  body: z.string().max(MAX_LETTER_CHARS + 1000),
});

/** Creates or updates the practice's letter template for one denial category. */
export async function saveAppealTemplate(
  _: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const auth = await requireAuth();
  const t = await getT("appeals");
  // Authorization is checked on the server for every call; a hidden button is not access control (HC-4.5).
  if (!canManageAppealTemplates(auth.role)) return { error: t("letter.error.notAllowed") };
  const parsed = schema.safeParse({ category: formData.get("category"), body: formData.get("body") });
  if (!parsed.success) return { error: t("letter.error.invalidRequest") };

  const result = await withTenant(auth, (tx) =>
    saveTemplate(tx, auth, {
      category: parsed.data.category,
      body: parsed.data.body.replace(/\r\n?/g, "\n"),
    }),
  );
  if ("errorKey" in result) return { error: t(result.errorKey, result.params) };
  revalidatePath("/settings/appeal-templates", "layout");
  return { ok: true };
}
