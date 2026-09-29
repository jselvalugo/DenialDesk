"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canManageIntegrations } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { MAX_PAYER_MAPPING_ROWS, savePayerMappings } from "@/domain/integrations/payer-mappings";
import { getT } from "@/i18n/server";
import { connectionFormFailure, integrationActor, type ConnectionFormState } from "../../form-state";

// Payer mapping (docs/specs/patient-integrations.md PI2b). The action re-checks the role on the server
// (page visibility is not access control); the domain checks the role, the MFA step-up, the practice,
// the insurers, and the payers again, and audits each change in the same transaction.

/**
 * Saves the administrator's mapping decisions. The form sends three parallel lists, in row order:
 * `key` (the insurer), `payer` (the chosen payer's ID, or empty for not mapped), and `version` (the
 * mapping's `updated_at` as the page read it, or empty). Only strings are read; nothing about a row
 * is trusted beyond that: the domain validates every line. Success goes back to the page with the
 * number of mappings changed (the page shows the inline confirmation).
 */
export async function savePayerMappingsAction(
  _: ConnectionFormState,
  formData: FormData,
): Promise<ConnectionFormState> {
  const auth = await requireAuth();
  const t = await getT("integrations");
  if (!canManageIntegrations(auth.role)) return { error: t("error.notAdmin") };
  const id = z.uuid().safeParse(String(formData.get("id") ?? "").slice(0, 40));
  if (!id.success) return { error: t("error.notFound") };

  const strings = (name: string) =>
    formData
      .getAll(name)
      .slice(0, MAX_PAYER_MAPPING_ROWS + 1)
      .map((value) => (typeof value === "string" ? value.slice(0, 300) : null));
  const keys = strings("key");
  const chosen = strings("payer");
  const versions = strings("version");
  if (
    keys.length !== chosen.length ||
    keys.length !== versions.length ||
    [...keys, ...chosen, ...versions].some((value) => value === null)
  ) {
    return { error: t("error.unexpectedField") };
  }
  const lines = keys.map((key, index) => ({
    key: key as string,
    payerId: chosen[index] as string,
    version: versions[index] as string,
  }));

  const actor = integrationActor(auth);
  let changed: number;
  try {
    ({ changed } = await withTenant(auth, (tx) => savePayerMappings(tx, actor, id.data, lines, t)));
  } catch (error) {
    return connectionFormFailure(error, t);
  }
  revalidatePath(`/settings/integrations/${id.data}/payers`);
  redirect(`/settings/integrations/${id.data}/payers?saved=${changed}`);
}
