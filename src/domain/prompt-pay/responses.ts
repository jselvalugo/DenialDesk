import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { claims, promptPayResponses } from "@/db/schema";
import { audit } from "@/lib/audit";

export class PromptPayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptPayError";
  }
}

export const MAX_NOTE_LENGTH = 500;

function cleanNote(text: string, what: string): string {
  const note = text.trim();
  if (note.length < 5) throw new PromptPayError(`Say ${what}.`);
  if (note.length > MAX_NOTE_LENGTH) throw new PromptPayError(`Keep it under ${MAX_NOTE_LENGTH} characters.`);
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
  const note = cleanNote(input.note, "what the payer asked for");
  const [claim] = await tx
    .select({ id: claims.id, receivedDate: claims.payerReceivedDate })
    .from(claims)
    .where(eq(claims.id, input.claimId))
    .limit(1);
  if (!claim) throw new PromptPayError("Claim not found.");
  if (!claim.receivedDate) throw new PromptPayError("The payer hasn't received this claim yet.");
  if (input.responseDate < claim.receivedDate) {
    throw new PromptPayError("The payer's notice can't be dated before the payer received the claim.");
  }
  if (input.responseDate > input.today) throw new PromptPayError("The notice date can't be in the future.");
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
  const reason = cleanNote(input.reason, "why this entry is wrong");
  const [original] = await tx
    .select()
    .from(promptPayResponses)
    .where(and(eq(promptPayResponses.id, input.responseId), isNull(promptPayResponses.voidsResponseId)))
    .limit(1);
  if (!original) throw new PromptPayError("Entry not found.");
  if (original.kind !== "contest" || original.remittanceId) {
    throw new PromptPayError("Payments and denials come from remittances and can't be marked in error here.");
  }
  const [already] = await tx
    .select({ id: promptPayResponses.id })
    .from(promptPayResponses)
    .where(eq(promptPayResponses.voidsResponseId, original.id))
    .limit(1);
  if (already) throw new PromptPayError("This entry is already marked as recorded in error.");
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
