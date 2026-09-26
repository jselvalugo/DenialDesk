import { and, asc, count, desc, eq, sql, sum, type SQL } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import {
  claims,
  denials,
  patients,
  payers,
  promptPayResponses,
  remittanceClaims,
  remittanceEvents,
  remittances,
  users,
} from "@/db/schema";
import type { RemittanceStatus } from "./status";

export const REMITTANCES_PAGE_SIZE = 25;

export interface RemittanceFilters {
  status?: RemittanceStatus;
  payerId?: string;
  page: number;
}

/** One page of remittances, newest payment first, plus totals that ignore the filters. */
export async function remittanceList(tx: TenantTx, filters: RemittanceFilters) {
  const conditions: SQL[] = [];
  if (filters.status) conditions.push(eq(remittances.status, filters.status));
  if (filters.payerId) conditions.push(eq(remittances.payerId, filters.payerId));
  const where = and(...conditions);
  const claimCount = tx
    .select({ remittanceId: remittanceClaims.remittanceId, n: count().as("n") })
    .from(remittanceClaims)
    .groupBy(remittanceClaims.remittanceId)
    .as("claim_count");
  const rows = await tx
    .select({
      id: remittances.id,
      traceNumber: remittances.traceNumber,
      method: remittances.method,
      paymentDate: remittances.paymentDate,
      totalPaidCents: remittances.totalPaidCents,
      status: remittances.status,
      payerId: remittances.payerId,
      payerName: payers.name,
      claims: sql<number>`coalesce(${claimCount.n}, 0)::int`,
    })
    .from(remittances)
    .innerJoin(payers, eq(payers.id, remittances.payerId))
    .leftJoin(claimCount, eq(claimCount.remittanceId, remittances.id))
    .where(where)
    .orderBy(desc(remittances.paymentDate), desc(remittances.createdAt))
    .limit(REMITTANCES_PAGE_SIZE)
    .offset((filters.page - 1) * REMITTANCES_PAGE_SIZE);
  const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(remittances).where(where);
  const totals = await tx
    .select({
      status: remittances.status,
      n: count(),
      cents: sum(remittances.totalPaidCents).mapWith(Number),
    })
    .from(remittances)
    .groupBy(remittances.status);
  const byStatus = (status: RemittanceStatus) =>
    totals.find((t) => t.status === status) ?? { n: 0, cents: 0 };
  return {
    rows,
    total,
    summary: {
      ready: byStatus("received").n,
      readyCents: byStatus("received").cents ?? 0,
      posted: byStatus("posted").n,
      postedCents: byStatus("posted").cents ?? 0,
    },
  };
}

export async function getRemittance(tx: TenantTx, remittanceId: string) {
  const [row] = await tx
    .select({
      remittance: remittances,
      payerName: payers.name,
      payerEdiId: payers.ediPayerId,
      loadedByName: users.displayName,
    })
    .from(remittances)
    .innerJoin(payers, eq(payers.id, remittances.payerId))
    .leftJoin(users, eq(users.id, remittances.loadedBy))
    .where(eq(remittances.id, remittanceId))
    .limit(1);
  if (!row) return null;
  const lines = await tx
    .select({
      id: remittanceClaims.id,
      claimId: remittanceClaims.claimId,
      claimNumber: claims.claimNumber,
      patientId: patients.id,
      patientFirst: patients.firstName,
      patientLast: patients.lastName,
      mrn: patients.mrn,
      statusCode: remittanceClaims.statusCode,
      chargeCents: remittanceClaims.chargeCents,
      paidCents: remittanceClaims.paidCents,
      patientResponsibilityCents: remittanceClaims.patientResponsibilityCents,
      payerControlNumber: remittanceClaims.payerControlNumber,
      adjustments: remittanceClaims.adjustments,
      rarcs: remittanceClaims.rarcs,
    })
    .from(remittanceClaims)
    .innerJoin(claims, eq(claims.id, remittanceClaims.claimId))
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .where(eq(remittanceClaims.remittanceId, remittanceId))
    .orderBy(asc(claims.claimNumber));
  const history = await tx
    .select({
      id: remittanceEvents.id,
      event: remittanceEvents.event,
      reason: remittanceEvents.reason,
      createdAt: remittanceEvents.createdAt,
      actorId: remittanceEvents.actorId,
      actor: users.displayName,
    })
    .from(remittanceEvents)
    .leftJoin(users, eq(users.id, remittanceEvents.actorId))
    .where(eq(remittanceEvents.remittanceId, remittanceId))
    .orderBy(desc(remittanceEvents.createdAt), desc(remittanceEvents.id));
  const captured = await tx
    .select({
      id: denials.id,
      claimNumber: claims.claimNumber,
      groupCode: denials.groupCode,
      carc: denials.carc,
      category: denials.category,
      deniedCents: denials.deniedCents,
      status: denials.status,
    })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .where(eq(denials.remittanceId, remittanceId))
    .orderBy(asc(claims.claimNumber));
  return { ...row, lines, history, captured };
}

export type RemittanceDetail = NonNullable<Awaited<ReturnType<typeof getRemittance>>>;

/** Remittance payments on one claim, for the claim page (newest first). */
export async function claimPayments(tx: TenantTx, claimId: string) {
  return tx
    .select({
      remittanceId: remittances.id,
      traceNumber: remittances.traceNumber,
      paymentDate: remittances.paymentDate,
      status: remittances.status,
      statusCode: remittanceClaims.statusCode,
      paidCents: remittanceClaims.paidCents,
      patientResponsibilityCents: remittanceClaims.patientResponsibilityCents,
      adjustments: remittanceClaims.adjustments,
    })
    .from(remittanceClaims)
    .innerJoin(remittances, eq(remittances.id, remittanceClaims.remittanceId))
    .where(eq(remittanceClaims.claimId, claimId))
    .orderBy(desc(remittances.paymentDate));
}

/** Whether a claim has any prompt-pay responses yet (for linking from the claim page). */
export async function hasPromptPayResponses(tx: TenantTx, claimId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: promptPayResponses.id })
    .from(promptPayResponses)
    .where(eq(promptPayResponses.claimId, claimId))
    .limit(1);
  return Boolean(row);
}
