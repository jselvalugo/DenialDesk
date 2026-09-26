import { and, asc, desc, eq, inArray, isNotNull, notInArray } from "drizzle-orm";
import type { PromptPayClock } from "@rules/prompt-pay";
import type { TenantTx } from "@/db/tenant";
import { claims, patients, payers, promptPayResponses, remittances, users } from "@/db/schema";
import { UNSUBMITTED_STATUSES } from "@/domain/claims/status";
import { clockDay, clockFor, PROMPT_PAY_DUE_SOON_DAYS, type ClockState, type StoredResponse } from "./clock";

export const PROMPT_PAY_PAGE_SIZE = 25;
/** Upper bound on claims evaluated per request; clocks come from the rules engine, not SQL. */
export const PROMPT_PAY_LIMIT = 5_000;

export type PromptPayFilter = ClockState | "due_soon";

export interface PromptPayFilters {
  state?: PromptPayFilter;
  payerId?: string;
  page: number;
}

function hasOpenMilestone(clock: PromptPayClock): boolean {
  return clock.milestones.some((m) => m.state === "open" || m.state === "overdue");
}

function urgency(clock: PromptPayClock): number {
  if (clock.uncontestable) return -100_000;
  return clock.nextDue?.daysRemaining ?? Number.POSITIVE_INFINITY;
}

/**
 * Every claim on a Florida prompt-pay clock (received by the payer, regime covered by the rules),
 * most urgent first: uncontestable, then overdue milestones, then the soonest due. Totals ignore
 * the filters. `truncated` = more than PROMPT_PAY_LIMIT claims were received; the newest are evaluated.
 */
export async function promptPayOverview(tx: TenantTx, filters: PromptPayFilters, today: string) {
  const index = await tx
    .select({
      id: claims.id,
      payerId: claims.payerId,
      regime: payers.regime,
      electronic: claims.electronic,
      receivedDate: claims.payerReceivedDate,
    })
    .from(claims)
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .where(and(isNotNull(claims.payerReceivedDate), notInArray(claims.status, UNSUBMITTED_STATUSES)))
    .orderBy(desc(claims.payerReceivedDate), asc(claims.id))
    .limit(PROMPT_PAY_LIMIT);
  const responses = await responsesFor(
    tx,
    index.map((c) => c.id),
  );
  const evaluated = index
    // No legal clock without a verified regime (payer catalog, P2).
    .flatMap((row) => (row.regime ? [{ ...row, regime: row.regime }] : []))
    .map((row) => {
      const clock = clockFor({
        regime: row.regime,
        electronic: row.electronic,
        receivedDate: row.receivedDate!,
        responses: responses.get(row.id) ?? [],
        today,
      });
      return { ...row, clock };
    })
    .filter((row) => row.clock.applies);

  const dueSoon = (clock: PromptPayClock) =>
    clock.nextDue?.state === "open" && (clock.nextDue.daysRemaining ?? Infinity) <= PROMPT_PAY_DUE_SOON_DAYS;
  const summary = {
    open: evaluated.filter((r) => hasOpenMilestone(r.clock)).length,
    dueSoon: evaluated.filter((r) => dueSoon(r.clock)).length,
    late: evaluated.filter((r) => r.clock.state === "late").length,
    uncontestable: evaluated.filter((r) => r.clock.uncontestable).length,
    interestCents: evaluated.reduce((sum, r) => sum + r.clock.interestCents, 0),
  };

  const matching = evaluated
    .filter((r) => !filters.payerId || r.payerId === filters.payerId)
    .filter((r) =>
      !filters.state
        ? true
        : filters.state === "due_soon"
          ? dueSoon(r.clock)
          : r.clock.state === filters.state,
    )
    .sort((a, b) => urgency(a.clock) - urgency(b.clock) || b.receivedDate!.localeCompare(a.receivedDate!));
  const offset = (filters.page - 1) * PROMPT_PAY_PAGE_SIZE;
  const page = matching.slice(offset, offset + PROMPT_PAY_PAGE_SIZE);
  const details =
    page.length === 0
      ? []
      : await tx
          .select({
            id: claims.id,
            claimNumber: claims.claimNumber,
            billedCents: claims.billedCents,
            paidCents: claims.paidCents,
            patientId: patients.id,
            patientFirst: patients.firstName,
            patientLast: patients.lastName,
            mrn: patients.mrn,
            payerName: payers.name,
          })
          .from(claims)
          .innerJoin(patients, eq(patients.id, claims.patientId))
          .innerJoin(payers, eq(payers.id, claims.payerId))
          .where(
            inArray(
              claims.id,
              page.map((r) => r.id),
            ),
          );
  const byId = new Map(details.map((d) => [d.id, d]));
  const rows = page.flatMap((r) => {
    const detail = byId.get(r.id);
    if (!detail) return [];
    return [{ ...detail, ...r, day: clockDay(r.receivedDate!, today, hasOpenMilestone(r.clock)) }];
  });
  return { rows, total: matching.length, summary, truncated: index.length >= PROMPT_PAY_LIMIT };
}

async function responsesFor(tx: TenantTx, claimIds: string[]): Promise<Map<string, StoredResponse[]>> {
  const map = new Map<string, StoredResponse[]>();
  // Chunked: a large practice can have thousands of clocks.
  for (let i = 0; i < claimIds.length; i += 1_000) {
    const chunk = claimIds.slice(i, i + 1_000);
    const rows = await tx
      .select({
        id: promptPayResponses.id,
        claimId: promptPayResponses.claimId,
        kind: promptPayResponses.kind,
        responseDate: promptPayResponses.responseDate,
        cents: promptPayResponses.cents,
        voidsResponseId: promptPayResponses.voidsResponseId,
      })
      .from(promptPayResponses)
      .where(inArray(promptPayResponses.claimId, chunk));
    for (const row of rows) map.set(row.claimId, [...(map.get(row.claimId) ?? []), row]);
  }
  return map;
}

/** One claim's clock with its full response history (including entries recorded in error). */
export async function getPromptPayClock(tx: TenantTx, claimId: string, today: string) {
  const [row] = await tx
    .select({
      id: claims.id,
      claimNumber: claims.claimNumber,
      status: claims.status,
      billedCents: claims.billedCents,
      paidCents: claims.paidCents,
      electronic: claims.electronic,
      serviceDate: claims.serviceDate,
      receivedDate: claims.payerReceivedDate,
      patientId: patients.id,
      patientFirst: patients.firstName,
      patientLast: patients.lastName,
      mrn: patients.mrn,
      payerName: payers.name,
      regime: payers.regime,
    })
    .from(claims)
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .where(eq(claims.id, claimId))
    .limit(1);
  if (!row) return null;
  const history = await tx
    .select({
      id: promptPayResponses.id,
      kind: promptPayResponses.kind,
      responseDate: promptPayResponses.responseDate,
      cents: promptPayResponses.cents,
      note: promptPayResponses.note,
      voidsResponseId: promptPayResponses.voidsResponseId,
      remittanceId: promptPayResponses.remittanceId,
      traceNumber: remittances.traceNumber,
      recordedBy: promptPayResponses.recordedBy,
      recordedByName: users.displayName,
      createdAt: promptPayResponses.createdAt,
    })
    .from(promptPayResponses)
    .leftJoin(remittances, eq(remittances.id, promptPayResponses.remittanceId))
    .leftJoin(users, eq(users.id, promptPayResponses.recordedBy))
    .where(eq(promptPayResponses.claimId, claimId))
    .orderBy(desc(promptPayResponses.createdAt), desc(promptPayResponses.id));
  const clock =
    row.receivedDate && row.regime
      ? clockFor({
          regime: row.regime,
          electronic: row.electronic,
          receivedDate: row.receivedDate,
          responses: history,
          today,
        })
      : null;
  return { claim: row, history, clock };
}

export type PromptPayDetail = NonNullable<Awaited<ReturnType<typeof getPromptPayClock>>>;
