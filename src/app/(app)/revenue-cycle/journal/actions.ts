"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import {
  approveVoucher,
  exportVoucher,
  prepareVoucher,
  voidVoucher,
  VoucherError,
} from "@/domain/revenue-cycle/vouchers";

export interface VoucherActionState {
  error?: string;
}

const uuid = z.uuid();

/** Voucher errors are plain-language workflow messages (no PHI); anything else is rethrown. */
async function run<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    if (error instanceof VoucherError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function prepareVoucherAction(
  _: VoucherActionState,
  formData: FormData,
): Promise<VoucherActionState> {
  const auth = await requireAuth();
  const fileId = uuid.safeParse(formData.get("fileId"));
  if (!fileId.success) return { error: "Choose a monthly file." };
  const result = await run(() => withTenant(auth, (tx) => prepareVoucher(tx, auth, fileId.data)));
  if (!result.ok) return { error: result.error };
  redirect(`/revenue-cycle/journal/${result.value}`);
}

export async function approveVoucherAction(
  _: VoucherActionState,
  formData: FormData,
): Promise<VoucherActionState> {
  const auth = await requireAuth();
  const id = uuid.safeParse(formData.get("voucherId"));
  if (!id.success) return { error: "That voucher doesn't exist." };
  const result = await run(() => withTenant(auth, (tx) => approveVoucher(tx, auth, id.data)));
  if (!result.ok) return { error: result.error };
  revalidatePath(`/revenue-cycle/journal/${id.data}`);
  return {};
}

export async function voidVoucherAction(
  _: VoucherActionState,
  formData: FormData,
): Promise<VoucherActionState> {
  const auth = await requireAuth();
  const id = uuid.safeParse(formData.get("voucherId"));
  if (!id.success) return { error: "That voucher doesn't exist." };
  const reason = String(formData.get("reason") ?? "");
  const reversedInGl = formData.get("reversedInGl") === "on";
  const result = await run(() =>
    withTenant(auth, (tx) => voidVoucher(tx, auth, id.data, reason, { reversedInGl })),
  );
  if (!result.ok) return { error: result.error };
  revalidatePath(`/revenue-cycle/journal/${id.data}`);
  return {};
}

export type ExportResult = { ok: true; filename: string; csv: string } | { ok: false; error: string };

/**
 * Returns the GL import CSV for the browser to save. A server action (not a GET route) so the
 * framework's origin check applies and a link can't trigger the audited status change.
 */
export async function exportVoucherAction(voucherId: string): Promise<ExportResult> {
  const auth = await requireAuth();
  const id = uuid.safeParse(voucherId);
  if (!id.success) return { ok: false, error: "That voucher doesn't exist." };
  const result = await run(() => withTenant(auth, (tx) => exportVoucher(tx, auth, id.data)));
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath(`/revenue-cycle/journal/${id.data}`);
  return { ok: true, ...result.value };
}
