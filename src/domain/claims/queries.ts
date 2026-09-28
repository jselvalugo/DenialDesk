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

/** Sortable list columns (P4, docs/specs/record-pages.md). `patientName` sorts by last, then first. */
export const CLAIM_SORT_KEYS = [
  "claimNumber",
  "patientName",
  "payer",
  "serviceDate",
  "billed",
  "status",
] as const;
export type ClaimSortKey = (typeof CLAIM_SORT_KEYS)[number];
/** First-click direction for each sortable column. */
export const CLAIM_SORT_DEFAULT_DIR: Record<ClaimSortKey, "asc" | "desc"> = {
  claimNumber: "asc",
  patientName: "asc",
  payer: "asc",
  serviceDate: "desc",
  billed: "desc",
  status: "asc",
};

export interface ClaimFilters {
  group: "unsubmitted" | "in_process" | "all";
  payerId?: string;
  filing?: Exclude<FilingState, "open">;
  /** Omitted: keep the group's own priority order (filing urgency, or newest service date first). */
  sort?: ClaimSortKey;
  dir?: "asc" | "desc";
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

/** Drizzle `orderBy` for an explicit column sort on the SQL-backed (`in_process`/`all`) groups. */
function claimsOrderBy(sort: ClaimSortKey, dir: "asc" | "desc") {
  const d = dir === "asc" ? asc : desc;
  switch (sort) {
    case "claimNumber":
      return [d(claims.claimNumber), asc(claims.id)];
    case "patientName":
      return [d(patients.lastName), d(patients.firstName), asc(claims.id)];
    case "payer":
      return [d(payers.name), asc(claims.id)];
    case "serviceDate":
      return [d(claims.serviceDate), asc(claims.id)];
    case "billed":
      return [d(claims.billedCents), asc(claims.id)];
    case "status":
      return [d(claims.status), asc(claims.id)];
  }
}

/**
 * Every unsubmitted claim's filing status, most urgent first: past deadline, then soonest deadline,
 * then not configured (no filing rule for the regime), with a stable id tie-break. Loads the columns
 * needed both for that urgency order and for an explicit column sort (P4): a practice's unsubmitted
 * backlog is a working set (capped at `UNSUBMITTED_LIMIT`), so sorting it in memory is cheap.
 */
async function unsubmittedIndex(tx: TenantTx, today: string) {
  const rows = await tx
    .select({
      id: claims.id,
      claimNumber: claims.claimNumber,
      status: claims.status,
      payerId: claims.payerId,
      payerName: payers.name,
      regime: payers.regime,
      serviceDate: claims.serviceDate,
      billedCents: claims.billedCents,
      patientFirst: patients.firstName,
      patientLast: patients.lastName,
    })
    .from(claims)
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .where(inArray(claims.status, UNSUBMITTED_STATUSES))
    .orderBy(asc(claims.serviceDate), asc(claims.id))
    .limit(UNSUBMITTED_LIMIT);
  const withFiling = rows.map((row) => ({
    ...row,
    filing: filingStatus(row.regime, row.serviceDate, today),
  }));
  return { index: withFiling, truncated: rows.length >= UNSUBMITTED_LIMIT };
}

type IndexRow = Awaited<ReturnType<typeof unsubmittedIndex>>["index"][number];

/** Urgency order for the unsubmitted queue's default view: soonest deadline first (R-3.1.5). */
function byUrgency(a: IndexRow, b: IndexRow): number {
  const ad = a.filing.daysRemaining ?? Number.POSITIVE_INFINITY;
  const bd = b.filing.daysRemaining ?? Number.POSITIVE_INFINITY;
  return ad - bd || b.billedCents - a.billedCents || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** An explicit column sort (P4), with the same stable id tie-break as the SQL-backed groups. */
function byColumn(sort: ClaimSortKey, dir: "asc" | "desc"): (a: IndexRow, b: IndexRow) => number {
  const mul = dir === "asc" ? 1 : -1;
  return (a, b) => {
    let cmp = 0;
    switch (sort) {
      case "claimNumber":
        cmp = a.claimNumber.localeCompare(b.claimNumber);
        break;
      case "patientName":
        cmp = `${a.patientLast} ${a.patientFirst}`.localeCompare(`${b.patientLast} ${b.patientFirst}`);
        break;
      case "payer":
        cmp = a.payerName.localeCompare(b.payerName);
        break;
      case "serviceDate":
        cmp = a.serviceDate.localeCompare(b.serviceDate);
        break;
      case "billed":
        cmp = a.billedCents - b.billedCents;
        break;
      case "status":
        cmp = a.status.localeCompare(b.status);
        break;
    }
    if (cmp !== 0) return cmp * mul;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

export type ClaimListRow = ListRow & { filing: FilingStatus | null };

export interface FilingSummary {
  unsubmitted: number;
  unsubmittedCents: number;
  dueSoon: number;
  pastDeadline: number;
  notConfigured: number;
  /** Unsubmitted claims whose payer is unverified (no regime), so no deadline was computed at all. */
  payerUnverified: number;
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
    payerUnverified: index.filter((row) => row.filing.state === "payer_unverified").length,
  };
  const offset = (filters.page - 1) * CLAIMS_PAGE_SIZE;

  if (filters.group === "unsubmitted") {
    const matching = index.filter(
      (row) =>
        (!filters.payerId || row.payerId === filters.payerId) &&
        (!filters.filing || row.filing.state === filters.filing),
    );
    const ordered = filters.sort
      ? [...matching].sort(byColumn(filters.sort, filters.dir ?? CLAIM_SORT_DEFAULT_DIR[filters.sort]))
      : [...matching].sort(byUrgency);
    const page = ordered.slice(offset, offset + CLAIMS_PAGE_SIZE);
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
  const orderBy = filters.sort
    ? claimsOrderBy(filters.sort, filters.dir ?? CLAIM_SORT_DEFAULT_DIR[filters.sort])
    : [desc(claims.serviceDate), asc(claims.id)];
  const rows: ListRow[] = await baseQuery(tx)
    .where(where)
    .orderBy(...orderBy)
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

/**
 * Just enough to render and audit the "edit custom fields" page (breadcrumb, and the patient id
 * for the view audit) — never the patient's demographics, payer, provider, or lines, which that
 * page doesn't show (minimum necessary, R-5.1.2).
 */
export async function getClaimForCustomFields(tx: TenantTx, claimId: string) {
  const [row] = await tx
    .select({ id: claims.id, claimNumber: claims.claimNumber, patientId: claims.patientId })
    .from(claims)
    .where(eq(claims.id, claimId))
    .limit(1);
  return row ?? null;
}
