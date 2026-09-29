"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canConfigureSettings } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { updateLocationPlaceOfService, updateProviderBilling } from "@/domain/settings/billing";
import { getT } from "@/i18n/server";
import { billingActor, billingFailure, type BillingFormState } from "./form-state";

// Settings > Billing (docs/specs/claims.md C3a-S). Each action re-checks the role on the server (page
// visibility is not access control); the domain checks it again, plus the step-up for a TIN, and audits in
// the same transaction. Only strings are read, each bounded; tenant and user come from the session.

/** The fields the form sends, each bounded (SC-B3.1); the form's own extra keys (Next's action ID) are not read. */
function read<T extends z.ZodRawShape>(formData: FormData, shape: T) {
  const raw: Record<string, string> = {};
  for (const name of Object.keys(shape)) {
    const value = formData.get(name);
    raw[name] = typeof value === "string" ? value : "";
  }
  return z.strictObject(shape).safeParse(raw);
}

const providerShape = {
  id: z.string().max(40),
  firstName: z.string().max(200),
  lastName: z.string().max(200),
  addressLine1: z.string().max(200),
  city: z.string().max(200),
  state: z.string().max(20),
  postalCode: z.string().max(20),
  tinType: z.string().max(10),
  tin: z.string().max(30),
};
const locationShape = { id: z.string().max(40), placeOfService: z.string().max(20) };

export async function saveProviderBillingAction(
  _: BillingFormState,
  formData: FormData,
): Promise<BillingFormState> {
  const auth = await requireAuth();
  const t = await getT("settings");
  if (!canConfigureSettings(auth.role)) return { error: t("billing.error.notAdmin") };
  const form = read(formData, providerShape);
  if (!form.success) return { error: t("billing.error.fixFields") };
  const { id, ...input } = form.data;
  const actor = billingActor(auth);
  try {
    await withTenant(auth, (tx) => updateProviderBilling(tx, actor, id, input));
  } catch (error) {
    return billingFailure(error, t);
  }
  revalidatePath("/settings/billing");
  redirect("/settings/billing?saved=provider");
}

export async function saveLocationPlaceOfServiceAction(
  _: BillingFormState,
  formData: FormData,
): Promise<BillingFormState> {
  const auth = await requireAuth();
  const t = await getT("settings");
  if (!canConfigureSettings(auth.role)) return { error: t("billing.error.notAdmin") };
  const form = read(formData, locationShape);
  if (!form.success) return { error: t("billing.error.fixFields") };
  const actor = billingActor(auth);
  try {
    await withTenant(auth, (tx) =>
      updateLocationPlaceOfService(tx, actor, form.data.id, form.data.placeOfService),
    );
  } catch (error) {
    return billingFailure(error, t);
  }
  revalidatePath("/settings/billing");
  redirect("/settings/billing?saved=location");
}
