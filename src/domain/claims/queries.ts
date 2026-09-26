import { and, asc, count, desc, eq, inArray, notInArray, type SQL } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { claimLines, claims, denials, locations, patients, payers, providers } from "@/db/schema";
import { filingStatus, UNSUBMITTED_STATUSES, type FilingState, type FilingStatus } from "./status";
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
  patientId: claims.patientId,
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
 * Every unsubmitted claim's filing status, most urgent first: past deadline, then soonest deadline,
 * then not configured (no filing rule for the regime). Loads only the columns needed to sort; the
 * patient columns are read for the one page shown.
 */
async function unsubmittedIndex(tx: TenantTx, today: string) {
  const rows = await tx
    .select({
      id: claims.id,
      payerId: claims.payerId,
      regime: payers.regime,
      serviceDate: claims.serviceDate,
      billedCents: claims.billedCents,
    })
    .from(claims)
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .where(inArray(claims.status, UNSUBMITTED_STATUSES))
    .orderBy(asc(claims.serviceDate), asc(claims.id))
    .limit(UNSUBMITTED_LIMIT);
  const index = rows
    .map((row) => ({ ...row, filing: filingStatus(row.regime, row.serviceDate, today) }))
    .sort((a, b) => {
      const ad = a.filing.daysRemaining ?? Number.POSITIVE_INFINITY;
      const bd = b.filing.daysRemaining ?? Number.POSITIVE_INFINITY;
      return ad - bd || b.billedCents - a.billedCents;
    });
  return { index, truncated: rows.length >= UNSUBMITTED_LIMIT };
}

export type ClaimListRow = ListRow & { filing: FilingStatus | null };

export interface FilingSummary {
  unsubmitted: number;
  unsubmittedCents: number;
  dueSoon: number;
  pastDeadline: number;
  notConfigured: number;
}

/**
 * One page of claims plus the unsubmitted-claim totals (R-3.1.5), from a single scan of the
 * unsubmitted set. Totals ignore the list filters. `truncated` = more than UNSUBMITTED_LIMIT
 * unsubmitted claims, so totals and ordering cover the oldest ones only.
 */
export async function claimsOverview(
  tx: TenantTx,
  filters: ClaimFilters,
  today: string,
): Promise<{ rows: ClaimListRow[]; total: number; truncated: boolean; summary: FilingSummary }> {
  const { index, truncated } = await unsubmittedIndex(tx, today);
  const summary: FilingSummary = {
    unsubmitted: index.length,
    unsubmittedCents: index.reduce((sum, row) => sum + row.billedCents, 0),
    dueSoon: index.filter((row) => row.filing.state === "due_soon").length,
    pastDeadline: index.filter((row) => row.filing.state === "past_deadline").length,
    notConfigured: index.filter((row) => row.filing.state === "not_configured").length,
  };
  const offset = (filters.page - 1) * CLAIMS_PAGE_SIZE;

  if (filters.group === "unsubmitted") {
    const matching = index.filter(
      (row) =>
        (!filters.payerId || row.payerId === filters.payerId) &&
        (!filters.filing || row.filing.state === filters.filing),
    );
    const page = matching.slice(offset, offset + CLAIMS_PAGE_SIZE);
    const details =
      page.length === 0
        ? []
        : await baseQuery(tx).where(
            inArray(
              claims.id,
              page.map((row) => row.id),
            ),
          );
    const byId = new Map(details.map((row) => [row.id, row]));
    const rows = page.flatMap((row) => {
      const detail = byId.get(row.id);
      return detail ? [{ ...detail, filing: row.filing }] : [];
    });
    return { rows, total: matching.length, truncated, summary };
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
    summary,
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
