"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canPostRemittances, canVoidRemittances } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { CLAIM_STATUSES, type ClaimStatus } from "@/domain/claims/status";
import { decodeUpload } from "@/domain/revenue-cycle/monthly-file";
import {
  loadRemittance,
  postRemittance,
  RemittanceError,
  voidRemittance,
} from "@/domain/remittances/records";
import { Edi835Error, parse835 } from "@/edi/x12/835";
import { MAX_X12_BYTES } from "@/edi/x12/segments";
import type { Messages } from "@/i18n/messages/types";
import { getT } from "@/i18n/server";
import type { Params, Translator } from "@/i18n/translate";
import { auditSystem } from "@/lib/audit";
import { syntheticDataOnly } from "@/lib/env";

const MAX_NAMED = 5;

/** Joins a claim/trace-number list for an error message, translating the "and N more" tail. */
function joinNamed(values: string[], t: Translator<Messages["remittances"]>): string {
  const shown = values.slice(0, MAX_NAMED).join(", ");
  return values.length > MAX_NAMED ? t("error.andMore", { shown, count: values.length - MAX_NAMED }) : shown;
}

/** Renders a `RemittanceError`: joins any list fields and translates an embedded claim status. */
function remittanceMessage(
  error: RemittanceError,
  t: Translator<Messages["remittances"]>,
  tc: Translator<Messages["common"]>,
): string {
  const params: Params = {};
  for (const [key, value] of Object.entries(error.data ?? {})) {
    if (Array.isArray(value)) {
      params[key] = joinNamed(value, t);
    } else if (key === "status" && typeof value === "string" && value in CLAIM_STATUSES) {
      params[key] = tc(CLAIM_STATUSES[value as ClaimStatus].labelKey);
    } else {
      params[key] = value;
    }
  }
  return t(error.key, params);
}

export interface RemittanceActionState {
  error?: string;
  done?: string;
}

/**
 * Loads one 835 file as a remittance ready to post. The file is parsed in memory as untrusted
 * input and never stored; patient names and bank numbers in it are not read. Rejections are
 * audited without file content.
 */
export async function uploadRemittance(
  _: RemittanceActionState,
  formData: FormData,
): Promise<RemittanceActionState> {
  const auth = await requireAuth();
  const t = await getT("remittances");
  const tc = await getT("common");
  if (!canPostRemittances(auth.role)) return { error: t("action.error.forbiddenUpload") };
  const rejected = (reason: string) =>
    auditSystem({
      action: "remittance.upload_rejected",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      metadata: { reason },
    });

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: t("action.error.chooseFile") };
  if (file.size > MAX_X12_BYTES) {
    await rejected("size");
    return { error: t("action.error.fileTooLarge") };
  }
  if (syntheticDataOnly() && formData.get("syntheticAttestation") !== "on") {
    return { error: t("action.error.confirmSynthetic") };
  }
  const text = decodeUpload(await file.arrayBuffer());
  if (text === null) {
    await rejected("encoding");
    return { error: t("action.error.notPlainText") };
  }
  let id: string;
  try {
    const parsed = parse835(text);
    ({ id } = await withTenant(auth, (tx) =>
      loadRemittance(tx, { tenantId: auth.tenantId, userId: auth.userId, parsed }),
    ));
  } catch (error) {
    if (error instanceof Edi835Error) {
      await rejected("format");
      return { error: error.message };
    }
    if (error instanceof RemittanceError) {
      await rejected("matching");
      return { error: remittanceMessage(error, t, tc) };
    }
    throw error;
  }
  revalidatePath("/remittances");
  redirect(`/remittances/${id}`);
}

const idSchema = z.uuid();

export async function postRemittanceAction(
  _: RemittanceActionState,
  formData: FormData,
): Promise<RemittanceActionState> {
  const auth = await requireAuth();
  const t = await getT("remittances");
  const tc = await getT("common");
  if (!canPostRemittances(auth.role)) return { error: t("action.error.forbiddenPost") };
  const id = idSchema.safeParse(formData.get("remittanceId"));
  if (!id.success) return { error: t("action.error.reload") };
  try {
    const result = await withTenant(auth, (tx) =>
      postRemittance(tx, { tenantId: auth.tenantId, userId: auth.userId, remittanceId: id.data }),
    );
    revalidatePath(`/remittances/${id.data}`);
    revalidatePath("/remittances");
    const denials = result.denialsCaptured;
    return {
      done:
        denials > 0
          ? t("action.done.postedWithDenials", { claims: result.claims, denials })
          : t("action.done.postedNoDenials", { count: result.claims }),
    };
  } catch (error) {
    if (error instanceof RemittanceError) return { error: remittanceMessage(error, t, tc) };
    throw error;
  }
}

export async function voidRemittanceAction(
  _: RemittanceActionState,
  formData: FormData,
): Promise<RemittanceActionState> {
  const auth = await requireAuth();
  const t = await getT("remittances");
  const tc = await getT("common");
  if (!canVoidRemittances(auth.role)) return { error: t("action.error.forbiddenVoid") };
  const id = idSchema.safeParse(formData.get("remittanceId"));
  if (!id.success) return { error: t("action.error.reload") };
  try {
    await withTenant(auth, (tx) =>
      voidRemittance(tx, {
        tenantId: auth.tenantId,
        userId: auth.userId,
        remittanceId: id.data,
        reason: String(formData.get("reason") ?? "").slice(0, 1_000),
      }),
    );
    revalidatePath(`/remittances/${id.data}`);
    revalidatePath("/remittances");
    return { done: t("action.done.voided") };
  } catch (error) {
    if (error instanceof RemittanceError) return { error: remittanceMessage(error, t, tc) };
    throw error;
  }
}
