import { and, asc, count, desc, eq, inArray, notInArray, type SQL } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { claimLines, claims, denials, locations, patients, payers, providers } from "@/db/schema";
import { filingStatus, UNSUBMITTED_STATUSES, type FilingState } from "./status";
import { claimHistory } from "./versions";

export const CLAIMS_PAGE_SIZE = 25;
/**
 * Upper bound on unsubmitted claims loaded for filing-deadline sorting. Deadlines come from the rules
 * engine (effective-dated, per regime), so they are computed here rather than in SQL. A practice's
 * unsubmitted backlog is a working set, far below this.
 */
export const UNSUBMITTED_LIMIT = 5_000;

export interface ClaimFilters {
  group: "unsubmitted" | "in_process" | "all";
  payerId?: string;
  filing?: Exclude<FilingState, "open">;
  page: number;
}

const listColumns = {
  id: claims.id,
  claimNumber: claims.claimNumber,
  serviceDate: claims.serviceDate,
  billedCents: claims.billedCents,
  paidCents: claims.paidCents,
  status: claims.status,
  patientFirst: patients.firstName,
  patientLast: patients.lastName,
  mrn: patients.mrn,
  payerName: payers.name,
  regime: payers.regime,
};

type ListRow = Awaited<ReturnType<typeof baseQuery>>[number];

function baseQuery(tx: TenantTx) {
  return tx
    .select(listColumns)
    .from(claims)
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(payers, eq(payers.id, claims.payerId));
}

/**
 * Unsubmitted claims with their filing status, most urgent first: past deadline, then soonest
 * deadline, then not configured (no statutory rule for the regime).
 */
async function unsubmittedWithFiling(tx: TenantTx, today: string, payerId?: string) {
  const conditions: SQL[] = [inArray(claims.status, UNSUBMITTED_STATUSES)];
  if (payerId) conditions.push(eq(claims.payerId, payerId));
  const rows: ListRow[] = await baseQuery(tx)
    .where(and(...conditions))
    .orderBy(asc(claims.serviceDate), asc(claims.id))
    .limit(UNSUBMITTED_LIMIT);
  return rows
    .map((row) => ({ ...row, filing: filingStatus(row.regime, row.serviceDate, today) }))
    .sort((a, b) => {
      const ad = a.filing.daysRemaining ?? Number.POSITIVE_INFINITY;
      const bd = b.filing.daysRemaining ?? Number.POSITIVE_INFINITY;
      return ad - bd || b.billedCents - a.billedCents;
    });
}

export type ClaimListRow = ListRow & { filing: ReturnType<typeof filingStatus> | null };

export async function listClaims(
  tx: TenantTx,
  filters: ClaimFilters,
  today: string,
): Promise<{ rows: ClaimListRow[]; total: number; truncated: boolean }> {
  const offset = (filters.page - 1) * CLAIMS_PAGE_SIZE;
  if (filters.group === "unsubmitted") {
    const all = await unsubmittedWithFiling(tx, today, filters.payerId);
    const matching = filters.filing ? all.filter((row) => row.filing.state === filters.filing) : all;
    return {
      rows: matching.slice(offset, offset + CLAIMS_PAGE_SIZE),
      total: matching.length,
      truncated: all.length >= UNSUBMITTED_LIMIT,
    };
  }

  const conditions: SQL[] = [];
  if (filters.group === "in_process") conditions.push(notInArray(claims.status, UNSUBMITTED_STATUSES));
  if (filters.payerId) conditions.push(eq(claims.payerId, filters.payerId));
  const where = and(...conditions);
  const rows: ListRow[] = await baseQuery(tx)
    .where(where)
    .orderBy(desc(claims.serviceDate), asc(claims.claimNumber))
    .limit(CLAIMS_PAGE_SIZE)
    .offset(offset);
  const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(claims).where(where);
  return {
    rows: rows.map((row) => ({
      ...row,
      filing: UNSUBMITTED_STATUSES.includes(row.status)
        ? filingStatus(row.regime, row.serviceDate, today)
        : null,
    })),
    total,
    truncated: false,
  };
}

/** Totals for unsubmitted claims, independent of list filters (R-3.1.5). */
export async function filingSummary(tx: TenantTx, today: string) {
  const rows = await unsubmittedWithFiling(tx, today);
  return {
    unsubmitted: rows.length,
    unsubmittedCents: rows.reduce((sum, row) => sum + row.billedCents, 0),
    dueSoon: rows.filter((row) => row.filing.state === "due_soon").length,
    pastDeadline: rows.filter((row) => row.filing.state === "past_deadline").length,
    notConfigured: rows.filter((row) => row.filing.state === "not_configured").length,
  };
}

export async function getClaim(tx: TenantTx, claimId: string) {
  const [row] = await tx
    .select({
      claim: claims,
      patient: {
        id: patients.id,
        firstName: patients.firstName,
        lastName: patients.lastName,
        birthDate: patients.birthDate,
        mrn: patients.mrn,
        memberIdLast4: patients.memberIdLast4,
      },
      payer: payers,
      providerName: providers.name,
      providerNpi: providers.npi,
      locationName: locations.name,
    })
    .from(claims)
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .innerJoin(providers, eq(providers.id, claims.providerId))
    .innerJoin(locations, eq(locations.id, claims.locationId))
    .where(eq(claims.id, claimId))
    .limit(1);
  if (!row) return null;

  // Sequential: one transaction runs one query at a time.
  const lines = await tx
    .select()
    .from(claimLines)
    .where(eq(claimLines.claimId, claimId))
    .orderBy(asc(claimLines.lineNumber));
  const claimDenials = await tx
    .select({
      id: denials.id,
      carc: denials.carc,
      groupCode: denials.groupCode,
      category: denials.category,
      deniedCents: denials.deniedCents,
      status: denials.status,
      noticeDate: denials.noticeDate,
    })
    .from(denials)
    .where(eq(denials.claimId, claimId))
    .orderBy(desc(denials.noticeDate));
  const history = await claimHistory(tx, claimId);
  return { ...row, lines, denials: claimDenials, history };
}

export type ClaimDetail = NonNullable<Awaited<ReturnType<typeof getClaim>>>;
