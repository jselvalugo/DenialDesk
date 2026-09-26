"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { canRecordPromptPay } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { PromptPayError, recordContest, voidResponse } from "@/domain/prompt-pay/responses";

export interface PromptPayActionState {
  error?: string;
  done?: string;
}

const contestSchema = z.object({
  claimId: z.uuid(),
  responseDate: z.iso.date("Enter the date on the payer's notice."),
});

export async function recordContestAction(
  _: PromptPayActionState,
  formData: FormData,
): Promise<PromptPayActionState> {
  const auth = await requireAuth();
  if (!canRecordPromptPay(auth.role))
    return { error: "Your role can view prompt-pay clocks but not record responses." };
  const parsed = contestSchema.safeParse({
    claimId: formData.get("claimId"),
    responseDate: formData.get("responseDate"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };
  try {
    await withTenant(auth, (tx) =>
      recordContest(tx, {
        tenantId: auth.tenantId,
        userId: auth.userId,
        claimId: parsed.data.claimId,
        responseDate: parsed.data.responseDate,
        note: String(formData.get("note") ?? "").slice(0, 1_000),
        today: todayIn(),
      }),
    );
  } catch (error) {
    if (error instanceof PromptPayError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/prompt-pay/${parsed.data.claimId}`);
  redirect(`/prompt-pay/${parsed.data.claimId}`);
}

export async function voidResponseAction(
  _: PromptPayActionState,
  formData: FormData,
): Promise<PromptPayActionState> {
  const auth = await requireAuth();
  if (!canRecordPromptPay(auth.role))
    return { error: "Your role can view prompt-pay clocks but not change them." };
  const id = z.uuid().safeParse(formData.get("responseId"));
  if (!id.success) return { error: "Reload the page and try again." };
  try {
    const { claimId } = await withTenant(auth, (tx) =>
      voidResponse(tx, {
        tenantId: auth.tenantId,
        userId: auth.userId,
        responseId: id.data,
        reason: String(formData.get("reason") ?? "").slice(0, 1_000),
      }),
    );
    revalidatePath(`/prompt-pay/${claimId}`);
    return { done: "Marked as recorded in error." };
  } catch (error) {
    if (error instanceof PromptPayError) return { error: error.message };
    throw error;
  }
}
