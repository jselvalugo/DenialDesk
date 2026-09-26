"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canPostRemittances, canVoidRemittances } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { decodeUpload } from "@/domain/revenue-cycle/monthly-file";
import {
  loadRemittance,
  postRemittance,
  RemittanceError,
  voidRemittance,
} from "@/domain/remittances/records";
import { Edi835Error, parse835 } from "@/edi/x12/835";
import { MAX_X12_BYTES } from "@/edi/x12/segments";
import { auditSystem } from "@/lib/audit";
import { syntheticDataOnly } from "@/lib/env";

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
  if (!canPostRemittances(auth.role)) return { error: "Your role can view remittances but not load them." };
  const rejected = (reason: string) =>
    auditSystem({
      action: "remittance.upload_rejected",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      metadata: { reason },
    });

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an 835 file to upload." };
  if (file.size > MAX_X12_BYTES) {
    await rejected("size");
    return { error: "The file is larger than 5 MB. Upload one remittance per file." };
  }
  if (syntheticDataOnly() && formData.get("syntheticAttestation") !== "on") {
    return { error: "Confirm that the file contains synthetic data only." };
  }
  const text = decodeUpload(await file.arrayBuffer());
  if (text === null) {
    await rejected("encoding");
    return { error: "The file isn't plain text. Upload the 835 exactly as the payer sent it." };
  }
  let id: string;
  try {
    const parsed = parse835(text);
    ({ id } = await withTenant(auth, (tx) =>
      loadRemittance(tx, { tenantId: auth.tenantId, userId: auth.userId, parsed }),
    ));
  } catch (error) {
    if (error instanceof Edi835Error || error instanceof RemittanceError) {
      await rejected(error instanceof Edi835Error ? "format" : "matching");
      return { error: error.message };
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
  if (!canPostRemittances(auth.role)) return { error: "Your role can view remittances but not post them." };
  const id = idSchema.safeParse(formData.get("remittanceId"));
  if (!id.success) return { error: "Reload the page and try again." };
  try {
    const result = await withTenant(auth, (tx) =>
      postRemittance(tx, { tenantId: auth.tenantId, userId: auth.userId, remittanceId: id.data }),
    );
    revalidatePath(`/remittances/${id.data}`);
    revalidatePath("/remittances");
    const denials = result.denialsCaptured;
    return {
      done: `Posted to ${result.claims} claim${result.claims === 1 ? "" : "s"}${
        denials > 0 ? `; ${denials} denial${denials === 1 ? "" : "s"} added to the queue` : ""
      }.`,
    };
  } catch (error) {
    if (error instanceof RemittanceError) return { error: error.message };
    throw error;
  }
}

export async function voidRemittanceAction(
  _: RemittanceActionState,
  formData: FormData,
): Promise<RemittanceActionState> {
  const auth = await requireAuth();
  if (!canVoidRemittances(auth.role))
    return { error: "Only administrators and managers can void a remittance." };
  const id = idSchema.safeParse(formData.get("remittanceId"));
  if (!id.success) return { error: "Reload the page and try again." };
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
    return { done: "Voided." };
  } catch (error) {
    if (error instanceof RemittanceError) return { error: error.message };
    throw error;
  }
}
