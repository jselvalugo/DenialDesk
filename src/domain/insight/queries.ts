import { and, eq, exists, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { easternDayBoundsUtc, todayIn } from "@rules/calendar";
import type { TenantTx } from "@/db/tenant";
// `claims.patientId` is NOT NULL (src/db/schema.ts) — every claim has exactly one patient, so
// every fetch* below joins `patients` with an inner join (never left) for the small-cell
// suppression sensitivity check (R-8.7). If that column is ever made nullable, these joins must
// switch to a left join and treat a missing patient as not sensitive, never as an error.
import { claims, denials, patients, payers } from "@/db/schema";
import { audit } from "@/lib/audit";
import { OPEN_STATUSES } from "@/domain/denial-status";
import { isPayerVerified } from "@/domain/payers/verification";
import {
  appealOutcomesReport,
  claimsByStatusReport,
  denialRateReport,
  denialsByCategoryReport,
  denialsByDeadlineBucketReport,
  denialsByPayerReport,
} from "./calculations";
import type { ReportId } from "./catalog";

export interface Actor {
  tenantId: string;
  userId: string;
}

export interface ReportFilters {
  dateFrom: string;
  dateTo: string;
  payerId?: string | null;
}

/** Every report run is audited (R-7.5.1): aggregate output, but the query still reads PHI-adjacent rows. */
export async function recordReportViewed(
  tx: TenantTx,
  actor: Actor,
  reportId: ReportId,
  filters: ReportFilters,
  route: string,
) {
  await audit(tx, {
    action: "insight.report_viewed",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    metadata: {
      reportId,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      payerId: filters.payerId ?? null,
      route,
      purpose: "operational_reporting",
    },
  });
}

export async function recordReportExported(
  tx: TenantTx,
  actor: Actor,
  reportId: ReportId | "all",
  filters: ReportFilters,
  rowCount: number,
  route: string,
) {
  await audit(tx, {
    action: "insight.report_exported",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    metadata: {
      reportId,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      payerId: filters.payerId ?? null,
      rowCount,
      format: "xlsx",
      route,
      purpose: "operational_reporting",
    },
  });
}

function noticeDateRange(filters: ReportFilters) {
  return and(gte(denials.noticeDate, filters.dateFrom), lte(denials.noticeDate, filters.dateTo));
}

export async function fetchDenialsByCategory(tx: TenantTx, filters: ReportFilters) {
  const where = and(
    noticeDateRange(filters),
    filters.payerId ? eq(claims.payerId, filters.payerId) : undefined,
  );
  const rows = await tx
    .select({
      category: denials.category,
      carc: denials.carc,
      deniedCents: denials.deniedCents,
      sensitivityTags: patients.sensitivityTags,
    })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .where(where);
  return denialsByCategoryReport(rows.map((r) => ({ ...r, patientSensitive: r.sensitivityTags.length > 0 })));
}

export async function fetchDenialsByPayer(tx: TenantTx, filters: ReportFilters) {
  const rows = await tx
    .select({
      payerId: payers.id,
      payerName: payers.name,
      ediPayerId: payers.ediPayerId,
      regime: payers.regime,
      category: denials.category,
      deniedCents: denials.deniedCents,
      sensitivityTags: patients.sensitivityTags,
    })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .where(noticeDateRange(filters));
  return denialsByPayerReport(
    rows.map((r) => ({
      payerId: r.payerId,
      payerName: r.payerName,
      verified: isPayerVerified({ ediPayerId: r.ediPayerId, regime: r.regime }),
      category: r.category,
      deniedCents: r.deniedCents,
      patientSensitive: r.sensitivityTags.length > 0,
    })),
  );
}

/**
 * "Submitted" = not draft, with submittedAt (falling back to serviceDate when not yet submitted)
 * in the Eastern calendar-day range (spec #3, R-11 legal-clock time zone). Compares the bounds
 * (converted to UTC instants once) against the raw `submittedAt` column — never `submittedAt::date`
 * or another function wrapping the column — so a btree index on `(tenant_id, submitted_at)` can
 * still range-scan it (sargable).
 */
function submittedInRange(filters: ReportFilters) {
  const from = easternDayBoundsUtc(filters.dateFrom).start;
  const toExclusive = easternDayBoundsUtc(filters.dateTo).endExclusive;
  return or(
    and(gte(claims.submittedAt, from), lt(claims.submittedAt, toExclusive)),
    and(
      isNull(claims.submittedAt),
      gte(claims.serviceDate, filters.dateFrom),
      lte(claims.serviceDate, filters.dateTo),
    ),
  );
}

export async function fetchDenialRate(tx: TenantTx, filters: ReportFilters) {
  const submittedWhere = and(
    sql`${claims.status} <> 'draft'`,
    submittedInRange(filters),
    filters.payerId ? eq(claims.payerId, filters.payerId) : undefined,
  );
  const [submittedRow] = await tx
    .select({ count: sql<number>`count(distinct ${claims.id})::int` })
    .from(claims)
    .where(submittedWhere);
  const [deniedRow] = await tx
    .select({ count: sql<number>`count(distinct ${claims.id})::int` })
    .from(claims)
    .where(
      and(
        submittedWhere,
        // The denial counts by its own noticeDate, which may fall after the claim's submission
        // range boundary (spec #3) — never re-restricted to the date range here.
        exists(
          tx
            .select({ one: sql`1` })
            .from(denials)
            .where(eq(denials.claimId, claims.id)),
        ),
      ),
    );
  return denialRateReport(submittedRow?.count ?? 0, deniedRow?.count ?? 0);
}

export async function fetchDenialsByDeadlineBucket(tx: TenantTx, filters: ReportFilters, today = todayIn()) {
  const where = and(
    inArray(denials.status, OPEN_STATUSES),
    noticeDateRange(filters),
    filters.payerId ? eq(claims.payerId, filters.payerId) : undefined,
  );
  const rows = await tx
    .select({
      appealDeadline: denials.appealDeadline,
      deniedCents: denials.deniedCents,
      sensitivityTags: patients.sensitivityTags,
    })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .where(where);
  return denialsByDeadlineBucketReport(
    rows.map((r) => ({ ...r, patientSensitive: r.sensitivityTags.length > 0 })),
    today,
  );
}

export async function fetchClaimsByStatus(tx: TenantTx, filters: ReportFilters) {
  const where = and(
    gte(claims.serviceDate, filters.dateFrom),
    lte(claims.serviceDate, filters.dateTo),
    filters.payerId ? eq(claims.payerId, filters.payerId) : undefined,
  );
  const rows = await tx
    .select({
      status: claims.status,
      billedCents: claims.billedCents,
      paidCents: claims.paidCents,
      sensitivityTags: patients.sensitivityTags,
    })
    .from(claims)
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .where(where);
  return claimsByStatusReport(rows.map((r) => ({ ...r, patientSensitive: r.sensitivityTags.length > 0 })));
}

export async function fetchAppealOutcomes(tx: TenantTx, filters: ReportFilters) {
  const where = and(
    inArray(denials.status, ["overturned", "upheld"]),
    noticeDateRange(filters),
    filters.payerId ? eq(claims.payerId, filters.payerId) : undefined,
  );
  const rows = await tx
    .select({
      payerId: payers.id,
      payerName: payers.name,
      category: denials.category,
      status: denials.status,
      deniedCents: denials.deniedCents,
      sensitivityTags: patients.sensitivityTags,
    })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .where(where);
  const outcomeStatus = (s: string) => (s === "overturned" ? ("overturned" as const) : ("upheld" as const));
  return appealOutcomesReport(
    rows.map((r) => ({
      key: r.payerId,
      label: r.payerName,
      status: outcomeStatus(r.status),
      deniedCents: r.deniedCents,
      patientSensitive: r.sensitivityTags.length > 0,
    })),
    rows.map((r) => ({
      key: r.category,
      label: r.category,
      status: outcomeStatus(r.status),
      deniedCents: r.deniedCents,
      patientSensitive: r.sensitivityTags.length > 0,
    })),
  );
}

export async function listPayers(tx: TenantTx) {
  return tx.select({ id: payers.id, name: payers.name }).from(payers).orderBy(payers.name);
}
