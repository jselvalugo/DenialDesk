import { and, eq, exists, gte, inArray, lte, sql } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import type { TenantTx } from "@/db/tenant";
import { claims, denials, payers } from "@/db/schema";
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
    },
  });
}

export async function recordReportExported(
  tx: TenantTx,
  actor: Actor,
  reportId: ReportId | "all",
  filters: ReportFilters,
  rowCount: number,
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
    .select({ category: denials.category, carc: denials.carc, deniedCents: denials.deniedCents })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .where(where);
  return denialsByCategoryReport(rows);
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
    })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .where(noticeDateRange(filters));
  return denialsByPayerReport(
    rows.map((r) => ({
      payerId: r.payerId,
      payerName: r.payerName,
      verified: isPayerVerified({ ediPayerId: r.ediPayerId, regime: r.regime }),
      category: r.category,
      deniedCents: r.deniedCents,
    })),
  );
}

/** "Submitted" = not draft, with submittedAt (falling back to serviceDate) in range (spec #3). */
function submittedDateExpr() {
  return sql<string>`coalesce(${claims.submittedAt}::date, ${claims.serviceDate})`;
}

export async function fetchDenialRate(tx: TenantTx, filters: ReportFilters) {
  const submittedWhere = and(
    sql`${claims.status} <> 'draft'`,
    gte(submittedDateExpr(), filters.dateFrom),
    lte(submittedDateExpr(), filters.dateTo),
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
        exists(
          tx
            .select({ one: sql`1` })
            .from(denials)
            .where(and(eq(denials.claimId, claims.id), noticeDateRange(filters))),
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
    .select({ appealDeadline: denials.appealDeadline, deniedCents: denials.deniedCents })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .where(where);
  return denialsByDeadlineBucketReport(rows, today);
}

export async function fetchClaimsByStatus(tx: TenantTx, filters: ReportFilters) {
  const where = and(
    gte(claims.serviceDate, filters.dateFrom),
    lte(claims.serviceDate, filters.dateTo),
    filters.payerId ? eq(claims.payerId, filters.payerId) : undefined,
  );
  const rows = await tx
    .select({ status: claims.status, billedCents: claims.billedCents, paidCents: claims.paidCents })
    .from(claims)
    .where(where);
  return claimsByStatusReport(rows);
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
    })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .where(where);
  const outcomeStatus = (s: string) => (s === "overturned" ? ("overturned" as const) : ("upheld" as const));
  return appealOutcomesReport(
    rows.map((r) => ({
      key: r.payerId,
      label: r.payerName,
      status: outcomeStatus(r.status),
      deniedCents: r.deniedCents,
    })),
    rows.map((r) => ({
      key: r.category,
      label: r.category,
      status: outcomeStatus(r.status),
      deniedCents: r.deniedCents,
    })),
  );
}

export async function listPayers(tx: TenantTx) {
  return tx.select({ id: payers.id, name: payers.name }).from(payers).orderBy(payers.name);
}
