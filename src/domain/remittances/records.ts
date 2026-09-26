import { and, asc, eq, inArray } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import {
  claimLines,
  claims,
  claimVersions,
  payers,
  promptPayResponses,
  remittanceClaims,
  remittanceEvents,
  remittances,
} from "@/db/schema";
import { snapshotOf } from "@/domain/claims/correction";
import { isUnsubmitted } from "@/domain/claims/status";
import type { Remittance835 } from "@/edi/x12/835";
import { audit } from "@/lib/audit";
import { postedClaimStatus } from "./status";

export class RemittanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemittanceError";
  }
}

export const MAX_REASON_LENGTH = 500;
/** Claim numbers named in an error message; the rest are counted. */
const MAX_NAMED = 5;

function nameSome(values: string[]): string {
  const shown = values.slice(0, MAX_NAMED).join(", ");
  return values.length > MAX_NAMED ? `${shown} and ${values.length - MAX_NAMED} more` : shown;
}

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
    throw new RemittanceError(
      "The file doesn't identify the payer (N1*PR payer ID). Ask the payer for a corrected file.",
    );
  }
  const matches = await tx
    .select({ id: payers.id })
    .from(payers)
    .where(eq(payers.ediPayerId, parsed.payer.ediPayerId))
    .limit(2);
  if (matches.length > 1) {
    throw new RemittanceError(
      `More than one payer has EDI payer ID ${parsed.payer.ediPayerId}. Fix the payer setup, then upload again.`,
    );
  }
  const payer = matches[0];
  if (!payer) {
    throw new RemittanceError(
      `No payer in this practice has EDI payer ID ${parsed.payer.ediPayerId}. Add the payer first, then upload again.`,
    );
  }
  const reversals = parsed.claims.filter((c) => c.statusCode === "22" || c.paidCents < 0);
  if (reversals.length > 0) {
    throw new RemittanceError(
      `This file reverses earlier payments (${nameSome(reversals.map((c) => c.claimNumber))}). Reversals can't be posted yet; post them by hand in the practice management system.`,
    );
  }
  const numbers = parsed.claims.map((c) => c.claimNumber);
  const repeated = numbers.filter((n, i) => numbers.indexOf(n) !== i);
  if (repeated.length > 0) {
    throw new RemittanceError(
      `Claims appear more than once in this file: ${nameSome([...new Set(repeated)])}.`,
    );
  }
  const [duplicate] = await tx
    .select({ id: remittances.id })
    .from(remittances)
    .where(and(eq(remittances.payerId, payer.id), eq(remittances.traceNumber, parsed.payment.traceNumber)))
    .limit(1);
  if (duplicate) {
    throw new RemittanceError(
      `Trace number ${parsed.payment.traceNumber} from this payer is already on file.`,
    );
  }

  const found = await tx
    .select({ id: claims.id, claimNumber: claims.claimNumber, status: claims.status })
    .from(claims)
    .where(and(eq(claims.payerId, payer.id), inArray(claims.claimNumber, numbers)));
  const byNumber = new Map(found.map((c) => [c.claimNumber, c]));
  const missing = numbers.filter((n) => !byNumber.has(n));
  if (missing.length > 0) {
    throw new RemittanceError(`No claim to this payer matches ${nameSome(missing)}. Nothing was loaded.`);
  }
  const notSent = found.filter((c) => isUnsubmitted(c.status) || c.status === "closed");
  if (notSent.length > 0) {
    throw new RemittanceError(
      `These claims are draft, rejected, or closed and can't take a payment: ${nameSome(notSent.map((c) => c.claimNumber))}.`,
    );
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
): Promise<{ claims: number }> {
  const [remittance] = await tx
    .select()
    .from(remittances)
    .where(eq(remittances.id, input.remittanceId))
    .for("update")
    .limit(1);
  if (!remittance) throw new RemittanceError("Remittance not found.");
  if (remittance.status !== "received") {
    throw new RemittanceError(
      `This remittance is already ${remittance.status === "void" ? "void" : "posted"}.`,
    );
  }
  const payments = await tx
    .select()
    .from(remittanceClaims)
    .where(eq(remittanceClaims.remittanceId, remittance.id))
    .orderBy(asc(remittanceClaims.createdAt), asc(remittanceClaims.id));
  const reason = `Posted from remittance ${remittance.traceNumber}`;

  for (const payment of payments) {
    const [claim] = await tx
      .select()
      .from(claims)
      .where(eq(claims.id, payment.claimId))
      .for("update")
      .limit(1);
    if (!claim) throw new RemittanceError("A claim on this remittance is no longer available.");
    if (isUnsubmitted(claim.status) || claim.status === "closed") {
      throw new RemittanceError(`Claim ${claim.claimNumber} is ${claim.status} and can't take a payment.`);
    }
    const paidTotal = claim.paidCents + payment.paidCents;
    const status = postedClaimStatus({
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
    metadata: { claims: payments.length, claimIds: payments.map((p) => p.claimId).join(",") },
  });
  return { claims: payments.length };
}

/** Voids a remittance loaded in error, before posting. It stays on file, marked void, with the reason. */
export async function voidRemittance(
  tx: TenantTx,
  input: { tenantId: string; userId: string; remittanceId: string; reason: string },
): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new RemittanceError("Say why this remittance is being voided.");
  if (reason.length > MAX_REASON_LENGTH) {
    throw new RemittanceError(`Keep the reason under ${MAX_REASON_LENGTH} characters.`);
  }
  const [remittance] = await tx
    .select({ id: remittances.id, status: remittances.status })
    .from(remittances)
    .where(eq(remittances.id, input.remittanceId))
    .for("update")
    .limit(1);
  if (!remittance) throw new RemittanceError("Remittance not found.");
  if (remittance.status !== "received") {
    throw new RemittanceError("Only a remittance that hasn't been posted can be voided.");
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
