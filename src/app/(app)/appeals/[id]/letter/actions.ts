"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canWorkAppeals } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { denialCategoryEnum } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { letterSavedPath } from "@/domain/appeals/letter/flash";
import { MAX_LETTER_CHARS } from "@/domain/appeals/letter/merge-fields";
import { attestLetter, saveLetterVersion, type ServiceError } from "@/domain/appeals/letter/service";
import { getT } from "@/i18n/server";

export interface LetterActionState {
  error?: string;
  ok?: boolean;
}

// Tenant, user, and role come from the verified session, never from the form (SC-B3.2).
const saveSchema = z.strictObject({
  appealId: z.uuid(),
  // A little headroom over the limit so the domain check, not Zod, produces the "too long" message.
  body: z.string().max(MAX_LETTER_CHARS + 1000),
  baseVersion: z.coerce.number().int().min(0).max(100000),
  sourceCategory: z.union([z.enum(denialCategoryEnum.enumValues), z.literal("")]),
});

const attestSchema = z.strictObject({
  appealId: z.uuid(),
  version: z.coerce.number().int().min(1).max(100000),
  confirm: z.literal("on"),
});

async function message(error: ServiceError): Promise<string> {
  const t = await getT("appeals");
  return t(error.errorKey, error.params);
}

/** Saves the editor's text as the next letter version. */
export async function saveLetter(_: LetterActionState, formData: FormData): Promise<LetterActionState> {
  const auth = await requireAuth();
  const t = await getT("appeals");
  if (!canWorkAppeals(auth.role)) return { error: t("letter.error.notAllowed") };
  const parsed = saveSchema.safeParse({
    appealId: formData.get("appealId"),
    body: formData.get("body"),
    baseVersion: formData.get("baseVersion"),
    sourceCategory: formData.get("sourceCategory") ?? "",
  });
  if (!parsed.success) return { error: t("letter.error.invalidRequest") };

  // Browsers send textarea line breaks as CRLF; store LF so "unchanged" and the review digest are exact.
  const body = parsed.data.body.replace(/\r\n?/g, "\n");
  const result = await withTenant(auth, (tx) =>
    saveLetterVersion(tx, auth, {
      appealId: parsed.data.appealId,
      body,
      baseVersion: parsed.data.baseVersion,
      sourceCategory: parsed.data.sourceCategory || null,
    }),
  );
  if ("errorKey" in result) return { error: await message(result) };
  revalidatePath(`/appeals/${parsed.data.appealId}`, "layout");
  // Back to the plain letter URL: a `?template=` from "Load template" must not stay and reload over the save.
  // `?saved=1` lets the page confirm the save, since the form state is gone after a redirect.
  redirect(letterSavedPath(parsed.data.appealId));
}

/** Records the signed-in user's review of the latest letter version (R-7.11.2). */
export async function attestLetterAction(
  _: LetterActionState,
  formData: FormData,
): Promise<LetterActionState> {
  const auth = await requireAuth();
  const t = await getT("appeals");
  if (!canWorkAppeals(auth.role)) return { error: t("letter.error.notAllowed") };
  const confirmed = formData.get("confirm") === "on";
  if (!confirmed) return { error: t("letter.error.attestNotConfirmed") };
  const parsed = attestSchema.safeParse({
    appealId: formData.get("appealId"),
    version: formData.get("version"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: t("letter.error.invalidRequest") };

  const result = await withTenant(auth, (tx) =>
    attestLetter(tx, auth, { appealId: parsed.data.appealId, version: parsed.data.version }),
  );
  if ("errorKey" in result) return { error: await message(result) };
  revalidatePath(`/appeals/${parsed.data.appealId}`, "layout");
  return { ok: true };
}
