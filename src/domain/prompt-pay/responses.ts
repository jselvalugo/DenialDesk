import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { claims, promptPayResponses } from "@/db/schema";
import type { MessageKey } from "@/i18n/messages/types";
import type { Params } from "@/i18n/translate";
import { audit } from "@/lib/audit";
import { en } from "@/i18n/messages/en";
import { createTranslator } from "@/i18n/translate";

/** Carries a message key (promptPay namespace) instead of English text; the action translates it. */
const english = createTranslator(en.promptPay, "en");
function englishMessage(key: MessageKey<"promptPay">, params?: Params): string {
  return english(key, params);
}

export class PromptPayError extends Error {
  constructor(
    public readonly key: MessageKey<"promptPay">,
    public readonly params?: Params,
  ) {
    // The message is the English text, so logs and tests read it directly; server actions translate
    // `key`/`params` for the user instead of showing `message`.
    super(englishMessage(key, params));
    this.name = "PromptPayError";
  }
}

export const MAX_NOTE_LENGTH = 500;

function cleanNote(text: string, tooShortKey: MessageKey<"promptPay">): string {
  const note = text.trim();
  if (note.length < 5) throw new PromptPayError(tooShortKey);
  if (note.length > MAX_NOTE_LENGTH) throw new PromptPayError("error.noteTooLong", { max: MAX_NOTE_LENGTH });
  return note;
}

/**
 * Records that the payer contested the claim or asked for more information. A person decides this
 * from the payer's notice; DenialDesk doesn't infer contests from CARC/RARC codes (review F4).
 */
export async function recordContest(
  tx: TenantTx,
  input: {
    tenantId: string;
    userId: string;
    claimId: string;
    responseDate: string;
    note: string;
    today: string;
  },
): Promise<{ id: string }> {
  const note = cleanNote(input.note, "error.sayWhatPayerAsked");
  const [claim] = await tx
    .select({ id: claims.id, receivedDate: claims.payerReceivedDate })
    .from(claims)
    .where(eq(claims.id, input.claimId))
    .limit(1);
  if (!claim) throw new PromptPayError("error.claimNotFound");
  if (!claim.receivedDate) throw new PromptPayError("error.notReceived");
  if (input.responseDate < claim.receivedDate) {
    throw new PromptPayError("error.noticeBeforeReceived");
  }
  if (input.responseDate > input.today) throw new PromptPayError("error.noticeInFuture");
  const [row] = await tx
    .insert(promptPayResponses)
    .values({
      tenantId: input.tenantId,
      claimId: claim.id,
      kind: "contest",
      responseDate: input.responseDate,
      note,
      recordedBy: input.userId,
    })
    .returning({ id: promptPayResponses.id });
  // The note can hold PHI: it stays in prompt_pay_responses; the audit row carries IDs only.
  await audit(tx, {
    action: "prompt_pay.response_recorded",
    actorUserId: input.userId,
    tenantId: input.tenantId,
    entityType: "prompt_pay_response",
    entityId: row!.id,
    metadata: { claimId: claim.id, kind: "contest" },
  });
  return { id: row!.id };
}

/**
 * Marks a contest as recorded in error: a new correction row with the reason; the original stays.
 * Payments and denials come from posted remittances and are corrected there (reversals, phase R2).
 */
export async function voidResponse(
  tx: TenantTx,
  input: { tenantId: string; userId: string; responseId: string; reason: string },
): Promise<{ claimId: string }> {
  const reason = cleanNote(input.reason, "error.sayWhyWrong");
  const [original] = await tx
    .select()
    .from(promptPayResponses)
    .where(and(eq(promptPayResponses.id, input.responseId), isNull(promptPayResponses.voidsResponseId)))
    .limit(1);
  if (!original) throw new PromptPayError("error.entryNotFound");
  if (original.kind !== "contest" || original.remittanceId) {
    throw new PromptPayError("error.notVoidable");
  }
  const [already] = await tx
    .select({ id: promptPayResponses.id })
    .from(promptPayResponses)
    .where(eq(promptPayResponses.voidsResponseId, original.id))
    .limit(1);
  if (already) throw new PromptPayError("error.alreadyVoided");
  const [row] = await tx
    .insert(promptPayResponses)
    .values({
      tenantId: input.tenantId,
      claimId: original.claimId,
      kind: original.kind,
      responseDate: original.responseDate,
      note: reason,
      voidsResponseId: original.id,
      recordedBy: input.userId,
    })
    .returning({ id: promptPayResponses.id });
  await audit(tx, {
    action: "prompt_pay.response_voided",
    actorUserId: input.userId,
    tenantId: input.tenantId,
    entityType: "prompt_pay_response",
    entityId: row!.id,
    reason: "recorded_in_error",
    metadata: { claimId: original.claimId, voidsResponseId: original.id },
  });
  return { claimId: original.claimId };
}
