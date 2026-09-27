import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { appealDeadline } from "@rules/deadlines";
import type { Regime } from "@rules/types";
import type { TenantTx } from "@/db/tenant";
import {
  claimLines,
  claims,
  claimVersions,
  denials,
  payers,
  type RemittanceAdjustment,
  promptPayResponses,
  remittanceClaims,
  remittanceEvents,
  remittances,
} from "@/db/schema";
import { snapshotOf } from "@/domain/claims/correction";
import { isUnsubmitted } from "@/domain/claims/status";
import type { Remittance835 } from "@/edi/x12/835";
import type { MessageKey } from "@/i18n/messages/types";
import { audit } from "@/lib/audit";
import { CARC } from "@/domain/carc";
import { isExpected, postedClaimStatus } from "./status";

/**
 * Carries a message key (remittances namespace) instead of English text. A value that's a list
 * (e.g. claim numbers) is joined and translated by the caller (`joinNamed` in the server action),
 * not here: this module never imports `@/i18n/server`.
 */
export class RemittanceError extends Error {
  constructor(
    public readonly key: MessageKey<"remittances">,
    public readonly data?: Record<string, string | number | string[]>,
  ) {
    super(key);
    this.name = "RemittanceError";
  }
}

export const MAX_REASON_LENGTH = 500;

/**
 * Stores a parsed 835 as a remittance ready to post (R1). Nothing on a claim changes until it is
 * posted. The payer is matched by EDI payer ID and every claim by number within that payer.
 */
export async function loadRemittance(
  tx: TenantTx,
  input: { tenantId: string; userId: string | null; parsed: Remittance835; source?: "upload" | "seed" },
): Promise<{ id: string }> {
  const { parsed } = input;
  if (!parsed.payer.ediPayerId) {
    throw new RemittanceError("error.noPayerId");
  }
  const matches = await tx
    .select({ id: payers.id })
    .from(payers)
    .where(eq(payers.ediPayerId, parsed.payer.ediPayerId))
    .limit(2);
  if (matches.length > 1) {
    throw new RemittanceError("error.duplicatePayerId", { ediPayerId: parsed.payer.ediPayerId });
  }
  const payer = matches[0];
  if (!payer) {
    throw new RemittanceError("error.unknownPayerId", { ediPayerId: parsed.payer.ediPayerId });
  }
  const emptyReversals = parsed.claims.filter((c) => c.statusCode === "22" && c.paidCents === 0);
  if (emptyReversals.length > 0) {
    throw new RemittanceError("error.emptyReversals", {
      claims: emptyReversals.map((c) => c.claimNumber),
    });
  }
  const badReversals = parsed.claims.filter(
    (c) => (c.statusCode === "22") !== c.paidCents < 0 && c.paidCents !== 0,
  );
  if (badReversals.length > 0) {
    throw new RemittanceError("error.badReversals", { claims: badReversals.map((c) => c.claimNumber) });
  }
  const numbers = parsed.claims.map((c) => c.claimNumber);
  // A reversal and its corrected claim share a claim number; anything else repeated is an error.
  const keys = parsed.claims.map((c) => `${c.claimNumber}|${c.statusCode === "22" ? "R" : "P"}`);
  const repeated = keys.filter((k, i) => keys.indexOf(k) !== i).map((k) => k.split("|")[0]!);
  if (repeated.length > 0) {
    throw new RemittanceError("error.duplicateClaims", { claims: [...new Set(repeated)] });
  }
  const [duplicate] = await tx
    .select({ id: remittances.id })
    .from(remittances)
    .where(and(eq(remittances.payerId, payer.id), eq(remittances.traceNumber, parsed.payment.traceNumber)))
    .limit(1);
  if (duplicate) {
    throw new RemittanceError("error.duplicateTrace", { traceNumber: parsed.payment.traceNumber });
  }

  const found = await tx
    .select({ id: claims.id, claimNumber: claims.claimNumber, status: claims.status })
    .from(claims)
    .where(and(eq(claims.payerId, payer.id), inArray(claims.claimNumber, numbers)));
  const byNumber = new Map(found.map((c) => [c.claimNumber, c]));
  const missing = [...new Set(numbers)].filter((n) => !byNumber.has(n));
  if (missing.length > 0) {
    throw new RemittanceError("error.noMatchingClaims", { claims: missing });
  }
  const notSent = found.filter((c) => isUnsubmitted(c.status) || c.status === "closed");
  if (notSent.length > 0) {
    throw new RemittanceError("error.notPayable", { claims: notSent.map((c) => c.claimNumber) });
  }

  const claimsPaid = parsed.claims.reduce((sum, c) => sum + c.paidCents, 0);
  const [row] = await tx
    .insert(remittances)
    .values({
      tenantId: input.tenantId,
      payerId: payer.id,
      method: parsed.payment.method,
      traceNumber: parsed.payment.traceNumber,
      paymentDate: parsed.payment.paymentDate,
      totalPaidCents: parsed.payment.totalPaidCents,
      providerAdjustmentCents: claimsPaid - parsed.payment.totalPaidCents,
      source: input.source ?? "upload",
      loadedBy: input.userId,
    })
    .returning({ id: remittances.id });
  const remittanceId = row!.id;
  await tx.insert(remittanceEvents).values({
    tenantId: input.tenantId,
    remittanceId,
    event: "received",
    reason: "Loaded from an 835 file",
    actorId: input.userId,
  });
  await tx.insert(remittanceClaims).values(
    parsed.claims.map((c) => ({
      tenantId: input.tenantId,
      remittanceId,
      claimId: byNumber.get(c.claimNumber)!.id,
      statusCode: c.statusCode,
      chargeCents: c.chargeCents,
      paidCents: c.paidCents,
      patientResponsibilityCents: c.patientResponsibilityCents,
      payerControlNumber: c.payerControlNumber,
      adjustments: c.adjustments,
      rarcs: c.rarcs,
    })),
  );
  await audit(tx, {
    action: "remittance.uploaded",
    actorUserId: input.userId,
    tenantId: input.tenantId,
    entityType: "remittance",
    entityId: remittanceId,
    metadata: { claims: parsed.claims.length, claimIds: found.map((c) => c.id).join(",") },
  });
  return { id: remittanceId };
}

/**
 * Posts a remittance (R1): each claim's paid total and status change with a new claim version
 * (R-3.10.3), and the payment or denial is recorded on the claim's prompt-pay clock (R-3.1.1).
 * All in the caller's transaction, so a failure leaves nothing half-posted.
 */
export async function postRemittance(
  tx: TenantTx,
  input: { tenantId: string; userId: string; remittanceId: string },
): Promise<{ claims: number; denialsCaptured: number }> {
  const [remittance] = await tx
    .select()
    .from(remittances)
    .where(eq(remittances.id, input.remittanceId))
    .for("update")
    .limit(1);
  if (!remittance) throw new RemittanceError("error.notFound");
  if (remittance.status !== "received") {
    throw new RemittanceError(remittance.status === "void" ? "error.alreadyVoid" : "error.alreadyPosted");
  }
  const payments = await tx
    .select()
    .from(remittanceClaims)
    .where(eq(remittanceClaims.remittanceId, remittance.id))
    .orderBy(asc(remittanceClaims.createdAt), asc(remittanceClaims.id));
  // Reversals first, so a corrected claim in the same file posts on top of the reversed total.
  payments.sort((x, y) => Number(y.statusCode === "22") - Number(x.statusCode === "22"));
  const reason = `Posted from remittance ${remittance.traceNumber}`;
  const claimsPaid = payments.reduce((sum, p) => sum + p.paidCents, 0);
  if (claimsPaid - remittance.providerAdjustmentCents !== remittance.totalPaidCents) {
    throw new RemittanceError("error.notBalanced");
  }
  const [payer] = await tx
    .select({ regime: payers.regime, appealWindowDays: payers.appealWindowDays })
    .from(payers)
    .where(eq(payers.id, remittance.payerId))
    .limit(1);
  if (!payer) throw new RemittanceError("error.payerUnavailable");
  let captured = 0;

  for (const payment of payments) {
    const [claim] = await tx
      .select()
      .from(claims)
      .where(eq(claims.id, payment.claimId))
      .for("update")
      .limit(1);
    if (!claim) throw new RemittanceError("error.claimUnavailable");
    if (isUnsubmitted(claim.status) || claim.status === "closed") {
      throw new RemittanceError("error.claimNotPayable", {
        claimNumber: claim.claimNumber,
        status: claim.status,
      });
    }
    const paidTotal = claim.paidCents + payment.paidCents;
    if (paidTotal < 0) {
      throw new RemittanceError("error.reversalExceedsPaid", { claimNumber: claim.claimNumber });
    }
    // A reversal takes the claim back to "accepted" until the payer's corrected claim posts.
    const status =
      payment.statusCode === "22"
        ? paidTotal > 0
          ? "partially_paid"
          : "acknowledged"
        : postedClaimStatus({
            statusCode: payment.statusCode,
            paidTotalCents: paidTotal,
            adjustments: payment.adjustments,
          });
    const lines = await tx
      .select()
      .from(claimLines)
      .where(eq(claimLines.claimId, claim.id))
      .orderBy(asc(claimLines.lineNumber));
    const version = claim.version + 1;
    await tx.insert(claimVersions).values({
      tenantId: input.tenantId,
      claimId: claim.id,
      version,
      snapshot: snapshotOf({ ...claim, status, paidCents: paidTotal }, lines),
      changedFields: [
        ...(status !== claim.status ? ["status"] : []),
        ...(paidTotal !== claim.paidCents ? ["paidCents"] : []),
      ],
      reason,
      changedBy: input.userId,
    });
    await tx
      .update(claims)
      .set({ status, paidCents: paidTotal, version, updatedAt: new Date() })
      .where(eq(claims.id, claim.id));
    if (payment.statusCode === "22") {
      await recordReversal(tx, {
        ...input,
        claimId: claim.id,
        remittance,
        reversedCents: -payment.paidCents,
      });
      continue;
    }
    await tx.insert(promptPayResponses).values({
      tenantId: input.tenantId,
      claimId: claim.id,
      // A zero payment still answers the claim (pay-or-deny met); interest applies only to money paid.
      kind: payment.paidCents > 0 ? "payment" : "denial",
      note:
        payment.paidCents > 0 || status === "denied"
          ? null
          : "Processed with nothing paid (patient responsibility)",
      responseDate: remittance.paymentDate,
      cents: Math.max(0, payment.paidCents),
      remittanceId: remittance.id,
      recordedBy: input.userId,
    });
    captured += await captureDenials(tx, {
      tenantId: input.tenantId,
      userId: input.userId,
      claimId: claim.id,
      remittanceId: remittance.id,
      noticeDate: remittance.paymentDate,
      payer,
      adjustments: payment.adjustments,
      rarcs: payment.rarcs,
    });
  }

  await tx.insert(remittanceEvents).values({
    tenantId: input.tenantId,
    remittanceId: remittance.id,
    event: "posted",
    reason: `Posted ${payments.length} claim payment${payments.length === 1 ? "" : "s"}`,
    actorId: input.userId,
  });
  await tx
    .update(remittances)
    .set({ status: "posted", updatedAt: new Date() })
    .where(eq(remittances.id, remittance.id));
  await audit(tx, {
    action: "remittance.posted",
    actorUserId: input.userId,
    tenantId: input.tenantId,
    entityType: "remittance",
    entityId: remittance.id,
    metadata: {
      claims: payments.length,
      claimIds: payments.map((p) => p.claimId).join(","),
      denialsCaptured: captured,
    },
  });
  return { claims: payments.length, denialsCaptured: captured };
}

/** Voids a remittance loaded in error, before posting. It stays on file, marked void, with the reason. */
export async function voidRemittance(
  tx: TenantTx,
  input: { tenantId: string; userId: string; remittanceId: string; reason: string },
): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new RemittanceError("error.voidReasonRequired");
  if (reason.length > MAX_REASON_LENGTH) {
    throw new RemittanceError("error.reasonTooLong", { max: MAX_REASON_LENGTH });
  }
  const [remittance] = await tx
    .select({ id: remittances.id, status: remittances.status })
    .from(remittances)
    .where(eq(remittances.id, input.remittanceId))
    .for("update")
    .limit(1);
  if (!remittance) throw new RemittanceError("error.notFound");
  if (remittance.status !== "received") {
    throw new RemittanceError("error.onlyUnposted");
  }
  await tx.insert(remittanceEvents).values({
    tenantId: input.tenantId,
    remittanceId: remittance.id,
    event: "void",
    reason,
    actorId: input.userId,
  });
  await tx
    .update(remittances)
    .set({ status: "void", updatedAt: new Date() })
    .where(eq(remittances.id, remittance.id));
  // The typed reason stays in remittance_events; the audit row carries IDs only.
  await audit(tx, {
    action: "remittance.voided",
    actorUserId: input.userId,
    tenantId: input.tenantId,
    entityType: "remittance",
    entityId: remittance.id,
    reason: "remittance_void",
  });
}

/**
 * A reversal takes back an earlier payment: the payment response it reverses is marked recorded in
 * error on the prompt-pay clock (the matching amount, else the latest), so the clock and interest
 * follow the money. Nothing is deleted.
 */
async function recordReversal(
  tx: TenantTx,
  input: {
    tenantId: string;
    userId: string;
    claimId: string;
    remittance: { id: string; traceNumber: string; paymentDate: string };
    reversedCents: number;
  },
) {
  const responses = await tx
    .select()
    .from(promptPayResponses)
    .where(eq(promptPayResponses.claimId, input.claimId))
    .orderBy(desc(promptPayResponses.responseDate), desc(promptPayResponses.createdAt));
  const voided = new Set(responses.flatMap((r) => (r.voidsResponseId ? [r.voidsResponseId] : [])));
  const open = responses.filter((r) => r.kind === "payment" && !r.voidsResponseId && !voided.has(r.id));
  const target = open.find((r) => r.cents === input.reversedCents);
  if (!target) {
    // Don't guess which payment is being taken back: a person reconciles it (nothing is posted).
    throw new RemittanceError("error.reversalMismatch");
  }
  const [row] = await tx
    .insert(promptPayResponses)
    .values({
      tenantId: input.tenantId,
      claimId: input.claimId,
      kind: "payment",
      responseDate: target.responseDate,
      note: `Reversed by remittance ${input.remittance.traceNumber}`,
      voidsResponseId: target.id,
      remittanceId: input.remittance.id,
      recordedBy: input.userId,
    })
    .returning({ id: promptPayResponses.id });
  await audit(tx, {
    action: "prompt_pay.response_voided",
    actorUserId: input.userId,
    tenantId: input.tenantId,
    entityType: "prompt_pay_response",
    entityId: row!.id,
    reason: "remittance_reversal",
    metadata: { claimId: input.claimId, voidsResponseId: target.id, remittanceId: input.remittance.id },
  });
}

/**
 * Denials captured from a posted claim payment: one per adjustment the practice didn't expect
 * (see isExpected). The category is DenialDesk's own ⚠️ VERIFY mapping (src/domain/carc.ts, OA-021).
 */
async function captureDenials(
  tx: TenantTx,
  input: {
    tenantId: string;
    userId: string;
    claimId: string;
    remittanceId: string;
    noticeDate: string;
    payer: { regime: Regime | null; appealWindowDays: number | null };
    adjustments: RemittanceAdjustment[];
    rarcs: string[];
  },
): Promise<number> {
  // No regime (unverified payer) or no contract window: no deadline is invented (shown as not set).
  const deadline = input.payer.regime
    ? appealDeadline({
        regime: input.payer.regime,
        noticeDate: input.noticeDate,
        payerAppealWindowDays: input.payer.appealWindowDays,
      })
    : null;
  // RARCs on a claim-level CLP loop apply to the whole claim, so each captured denial carries them.
  const rows = input.adjustments
    .filter((a) => !isExpected(a) && a.cents > 0)
    .map((a) => {
      return {
        tenantId: input.tenantId,
        claimId: input.claimId,
        groupCode: a.group,
        carc: a.carc,
        rarcs: input.rarcs,
        category: CARC[a.carc]?.category ?? ("other" as const),
        deniedCents: a.cents,
        noticeDate: input.noticeDate,
        appealDeadline: deadline?.date ?? null,
        appealDeadlineBasis: deadline?.basis ?? null,
        remittanceId: input.remittanceId,
      };
    });
  if (rows.length === 0) return 0;
  const created = await tx.insert(denials).values(rows).returning({ id: denials.id });
  for (const denial of created) {
    await audit(tx, {
      action: "denial.captured",
      actorUserId: input.userId,
      tenantId: input.tenantId,
      entityType: "denial",
      entityId: denial.id,
      metadata: { claimId: input.claimId, remittanceId: input.remittanceId },
    });
  }
  return created.length;
}
