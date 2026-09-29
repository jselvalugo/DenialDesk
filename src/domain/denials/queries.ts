import { and, asc, count, desc, eq, gte, inArray, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import { addCalendarDays } from "@rules/calendar";
import type { TenantTx } from "@/db/tenant";
import {
  auditEvents,
  claimLines,
  claims,
  denialNotes,
  denials,
  locations,
  memberships,
  patients,
  payers,
  providers,
  users,
} from "@/db/schema";
import { ACTION_STATUSES, OPEN_STATUSES } from "@/domain/denial-status";
import type { DenialCategory } from "@/domain/carc";
import { isPayerVerified } from "@/domain/payers/verification";
import { memberIdForOtherPayer, memberIdLast4ForClaim } from "@/domain/patients/member-id";
import { assertNever } from "@/lib/assert-never";

export const PAGE_SIZE = 25;
/** Queue "due soon" window: a display setting, not a legal value. */
export const DUE_SOON_DAYS = 7;
/** Overview "next deadlines" also shows denials overdue by up to this many days (display window). */
export const RECENTLY_OVERDUE_DAYS = 30;

export type QueueSortKey = "deadline" | "amount" | "notice";
/**
 * First-click direction for each sortable column (P4, docs/specs/record-pages.md). Indexed:
 * `deadline` (`denials_queue_deadline_idx`), `amount` (`denials_queue_amount_idx`), `notice`
 * (`denials_tenant_notice_date_idx`).
 */
export const QUEUE_SORT_DEFAULT_DIR: Record<QueueSortKey, "asc" | "desc"> = {
  deadline: "asc",
  amount: "desc",
  notice: "desc",
};

export interface QueueFilters {
  status: "open" | "closed" | "all";
  payerId?: string;
  category?: DenialCategory;
  assignee?: "me" | "unassigned";
  sort: QueueSortKey;
  /** Defaults to `QUEUE_SORT_DEFAULT_DIR[sort]` when omitted (callers that don't parse a URL). */
  dir?: "asc" | "desc";
  page: number;
}

function filterConditions(filters: QueueFilters, userId: string): SQL[] {
  const conditions: SQL[] = [];
  if (filters.status === "open") conditions.push(inArray(denials.status, OPEN_STATUSES));
  if (filters.status === "closed") conditions.push(notInArray(denials.status, OPEN_STATUSES));
  if (filters.payerId) conditions.push(eq(claims.payerId, filters.payerId));
  if (filters.category) conditions.push(eq(denials.category, filters.category));
  if (filters.assignee === "me") conditions.push(eq(denials.assigneeId, userId));
  if (filters.assignee === "unassigned") conditions.push(isNull(denials.assigneeId));
  return conditions;
}

function denialsOrderBy(sort: QueueSortKey, dir: "asc" | "desc") {
  switch (sort) {
    case "amount":
      return [dir === "asc" ? asc(denials.deniedCents) : desc(denials.deniedCents), asc(denials.id)];
    case "notice":
      // Pre-P4 shape exactly: no D1 awaiting-action priority here, only for `deadline` below.
      return [dir === "asc" ? asc(denials.noticeDate) : desc(denials.noticeDate), asc(denials.id)];
    case "deadline":
      return [
        // Denials still awaiting practice action sort ahead of ones whose deadline is already
        // met (e.g. appeal_submitted), so a soon-but-already-handled deadline never bumps a
        // denial that still needs work (D1). This priority holds for either direction; only the
        // deadline ordering within each group flips with `dir`.
        sql`case when ${denials.status} in (${sql.join(
          ACTION_STATUSES.map((s) => sql`${s}`),
          sql`, `,
        )}) then 0 else 1 end`,
        dir === "asc"
          ? sql`${denials.appealDeadline} asc nulls last`
          : sql`${denials.appealDeadline} desc nulls last`,
        desc(denials.deniedCents),
        asc(denials.id),
      ];
    default:
      return assertNever(sort);
  }
}

export async function listDenials(tx: TenantTx, filters: QueueFilters, userId: string) {
  const where = and(...filterConditions(filters, userId));
  const dir = filters.dir ?? QUEUE_SORT_DEFAULT_DIR[filters.sort];
  const order = denialsOrderBy(filters.sort, dir);

  const rows = await tx
    .select({
      id: denials.id,
      claimNumber: claims.claimNumber,
      patientFirst: patients.firstName,
      patientLast: patients.lastName,
      mrn: patients.mrn,
      payerName: payers.name,
      regime: payers.regime,
      carc: denials.carc,
      groupCode: denials.groupCode,
      category: denials.category,
      deniedCents: denials.deniedCents,
      appealDeadline: denials.appealDeadline,
      appealSubmittedOn: denials.appealSubmittedOn,
      noticeDate: denials.noticeDate,
      status: denials.status,
      assigneeName: users.displayName,
    })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .leftJoin(users, eq(users.id, denials.assigneeId))
    .where(where)
    .orderBy(...order)
    .limit(PAGE_SIZE)
    .offset((filters.page - 1) * PAGE_SIZE);

  const [{ total } = { total: 0 }] = await tx
    .select({ total: count() })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .where(where);

  return { rows, total };
}

/** Totals for open denials, independent of queue filters. */
export async function queueSummary(tx: TenantTx, today: string) {
  const soon = addCalendarDays(today, DUE_SOON_DAYS);
  const awaiting = inArray(denials.status, ACTION_STATUSES);
  const [summary] = await tx
    .select({
      open: count(),
      atRiskCents: sql<number>`coalesce(sum(${denials.deniedCents}), 0)::bigint`.mapWith(Number),
      // Deadline counts only cover denials still waiting on the practice (not appeals already filed).
      dueSoon:
        sql<number>`count(*) filter (where ${awaiting} and ${denials.appealDeadline} between ${today} and ${soon})`.mapWith(
          Number,
        ),
      overdue:
        sql<number>`count(*) filter (where ${awaiting} and ${denials.appealDeadline} < ${today})`.mapWith(
          Number,
        ),
      noDeadline:
        sql<number>`count(*) filter (where ${awaiting} and ${denials.appealDeadline} is null)`.mapWith(
          Number,
        ),
    })
    .from(denials)
    .where(inArray(denials.status, OPEN_STATUSES));
  return summary ?? { open: 0, atRiskCents: 0, dueSoon: 0, overdue: 0, noDeadline: 0 };
}

export async function upcomingDeadlines(tx: TenantTx, today: string, limit = 5) {
  return tx
    .select({
      id: denials.id,
      claimNumber: claims.claimNumber,
      payerName: payers.name,
      category: denials.category,
      deniedCents: denials.deniedCents,
      appealDeadline: denials.appealDeadline,
      status: denials.status,
    })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .where(
      and(
        inArray(denials.status, ACTION_STATUSES),
        gte(denials.appealDeadline, addCalendarDays(today, -RECENTLY_OVERDUE_DAYS)),
      ),
    )
    .orderBy(asc(denials.appealDeadline))
    .limit(limit);
}

export async function openByCategory(tx: TenantTx) {
  return tx
    .select({
      category: denials.category,
      count: count(),
      deniedCents: sql<number>`sum(${denials.deniedCents})::bigint`.mapWith(Number),
    })
    .from(denials)
    .where(inArray(denials.status, OPEN_STATUSES))
    .groupBy(denials.category)
    .orderBy(desc(sql`sum(${denials.deniedCents})`));
}

/** Every payer the practice can pick from, alphabetical, flagged when it isn't yet verified. */
export async function payerOptions(tx: TenantTx) {
  const rows = await tx
    .select({ id: payers.id, name: payers.name, ediPayerId: payers.ediPayerId, regime: payers.regime })
    .from(payers)
    .orderBy(asc(payers.name));
  return rows.map((p) => ({ id: p.id, name: p.name, verified: isPayerVerified(p) }));
}

export async function teamMembers(tx: TenantTx, tenantId: string) {
  return tx
    .select({ id: users.id, displayName: users.displayName, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.tenantId, tenantId))
    .orderBy(asc(users.displayName));
}

export async function getDenial(tx: TenantTx, denialId: string) {
  const [row] = await tx
    .select({
      denial: denials,
      claim: claims,
      patient: {
        id: patients.id,
        firstName: patients.firstName,
        lastName: patients.lastName,
        birthDate: patients.birthDate,
        mrn: patients.mrn,
        // Null on a synced patient without a mapped coverage (PI1a); shown the same as self-pay.
        // Only for the claim's own payer (R-5.1.2, `member-id.ts`).
        memberIdLast4: memberIdLast4ForClaim,
        memberIdForOtherPayer,
      },
      payer: payers,
      providerName: providers.name,
      providerNpi: providers.npi,
      locationName: locations.name,
      assigneeName: users.displayName,
    })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .innerJoin(providers, eq(providers.id, claims.providerId))
    .innerJoin(locations, eq(locations.id, claims.locationId))
    .leftJoin(users, eq(users.id, denials.assigneeId))
    .where(eq(denials.id, denialId))
    .limit(1);
  if (!row) return null;

  const lines = await tx
    .select()
    .from(claimLines)
    .where(eq(claimLines.claimId, row.claim.id))
    .orderBy(asc(claimLines.lineNumber));
  const notes = await tx
    .select({
      id: denialNotes.id,
      body: denialNotes.body,
      createdAt: denialNotes.createdAt,
      author: users.displayName,
    })
    .from(denialNotes)
    .innerJoin(users, eq(users.id, denialNotes.authorId))
    .where(eq(denialNotes.denialId, denialId))
    .orderBy(desc(denialNotes.createdAt));
  const activity = await tx
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      metadata: auditEvents.metadata,
      occurredAt: auditEvents.occurredAt,
      actor: users.displayName,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorUserId))
    .where(
      and(
        eq(auditEvents.entityType, "denial"),
        eq(auditEvents.entityId, denialId),
        inArray(auditEvents.action, ["denial.status_changed", "denial.assigned", "denial.note_added"]),
      ),
    )
    .orderBy(desc(auditEvents.occurredAt))
    .limit(20);

  return { ...row, lines, notes, activity };
}

export type DenialDetail = NonNullable<Awaited<ReturnType<typeof getDenial>>>;

/**
 * Just enough to render and audit the "edit custom fields" page (breadcrumb back to the claim, and
 * the patient id for the view audit) — never the patient's demographics, payer, provider, or lines,
 * which that page doesn't show (minimum necessary, R-5.1.2).
 */
export async function getDenialForCustomFields(tx: TenantTx, denialId: string) {
  const [row] = await tx
    .select({
      id: denials.id,
      claimId: claims.id,
      claimNumber: claims.claimNumber,
      patientId: claims.patientId,
    })
    .from(denials)
    .innerJoin(claims, eq(claims.id, denials.claimId))
    .where(eq(denials.id, denialId))
    .limit(1);
  return row ?? null;
}
