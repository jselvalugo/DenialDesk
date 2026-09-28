import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { addCalendarDays } from "@rules/calendar";
import type { TenantTx } from "@/db/tenant";
import {
  appealNotes,
  appeals,
  auditEvents,
  claimLines,
  claims,
  denials,
  patients,
  payers,
  users,
} from "@/db/schema";
import { APPEAL_AWAITING_STATUSES, APPEAL_OPEN_STATUSES, type AppealStatus } from "@/domain/appeals/status";
import type { AppealLevel } from "@/domain/appeals/types";

export const PAGE_SIZE = 25;
/** Same display window as the denial queue (denials/queries.ts): a UI setting, not a legal value. */
export const DUE_SOON_DAYS = 7;

export interface AppealQueueFilters {
  status: "open" | "closed" | "all";
  level?: AppealLevel;
  payerId?: string;
  sort: "deadline" | "amount";
  page: number;
}

function filterConditions(filters: AppealQueueFilters): SQL[] {
  const conditions: SQL[] = [];
  if (filters.status === "open") conditions.push(inArray(appeals.status, APPEAL_OPEN_STATUSES));
  if (filters.status === "closed")
    conditions.push(inArray(appeals.status, ["decided", "withdrawn", "dismissed"]));
  if (filters.level) conditions.push(eq(appeals.level, filters.level));
  if (filters.payerId) conditions.push(eq(claims.payerId, filters.payerId));
  return conditions;
}

export async function listAppeals(tx: TenantTx, filters: AppealQueueFilters) {
  const where = and(...filterConditions(filters));
  const order =
    filters.sort === "amount"
      ? [desc(denials.deniedCents), asc(appeals.id)]
      : [sql`${appeals.deadline} asc nulls last`, desc(denials.deniedCents), asc(appeals.id)];

  const rows = await tx
    .select({
      id: appeals.id,
      level: appeals.level,
      status: appeals.status,
      deadline: appeals.deadline,
      claimNumber: claims.claimNumber,
      payerName: payers.name,
      category: denials.category,
      deniedCents: denials.deniedCents,
      denialId: denials.id,
    })
    .from(appeals)
    .innerJoin(denials, eq(denials.id, appeals.denialId))
    .innerJoin(claims, eq(claims.id, appeals.claimId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .where(where)
    .orderBy(...order)
    .limit(PAGE_SIZE)
    .offset((filters.page - 1) * PAGE_SIZE);

  const [{ total } = { total: 0 }] = await tx
    .select({ total: count() })
    .from(appeals)
    .innerJoin(claims, eq(claims.id, appeals.claimId))
    .where(where);

  return { rows, total };
}

/** Totals for open appeals, independent of queue filters (spec: same rules as denial-queue.md). */
export async function appealQueueSummary(tx: TenantTx, today: string) {
  const soon = addCalendarDays(today, DUE_SOON_DAYS);
  const awaiting = inArray(appeals.status, APPEAL_AWAITING_STATUSES);
  const [summary] = await tx
    .select({
      open: count(),
      atStakeCents: sql<number>`coalesce(sum(${denials.deniedCents}), 0)::bigint`.mapWith(Number),
      dueSoon:
        sql<number>`count(*) filter (where ${awaiting} and ${appeals.deadline} between ${today} and ${soon})`.mapWith(
          Number,
        ),
      overdue: sql<number>`count(*) filter (where ${awaiting} and ${appeals.deadline} < ${today})`.mapWith(
        Number,
      ),
      noDeadline: sql<number>`count(*) filter (where ${awaiting} and ${appeals.deadline} is null)`.mapWith(
        Number,
      ),
    })
    .from(appeals)
    .innerJoin(denials, eq(denials.id, appeals.denialId))
    .where(inArray(appeals.status, APPEAL_OPEN_STATUSES));
  return summary ?? { open: 0, atStakeCents: 0, dueSoon: 0, overdue: 0, noDeadline: 0 };
}

export async function getAppeal(tx: TenantTx, appealId: string) {
  const [row] = await tx
    .select({
      appeal: appeals,
      denial: denials,
      claim: claims,
      payer: payers,
      patient: {
        id: patients.id,
        firstName: patients.firstName,
        lastName: patients.lastName,
        mrn: patients.mrn,
        // Null on a synced patient without a mapped coverage (PI1a); shown the same as self-pay.
        memberIdLast4: sql<string>`coalesce(${patients.memberIdLast4}, '')`,
      },
      filedByName: users.displayName,
    })
    .from(appeals)
    .innerJoin(denials, eq(denials.id, appeals.denialId))
    .innerJoin(claims, eq(claims.id, appeals.claimId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .leftJoin(users, eq(users.id, appeals.filedBy))
    .where(eq(appeals.id, appealId))
    .limit(1);
  if (!row) return null;

  const deniedLine = row.denial.claimLineId
    ? (
        await tx
          .select({
            id: claimLines.id,
            lineNumber: claimLines.lineNumber,
            procedureCode: claimLines.procedureCode,
          })
          .from(claimLines)
          .where(eq(claimLines.id, row.denial.claimLineId))
          .limit(1)
      )[0]
    : undefined;

  const notes = await tx
    .select({
      id: appealNotes.id,
      body: appealNotes.body,
      createdAt: appealNotes.createdAt,
      author: users.displayName,
    })
    .from(appealNotes)
    .innerJoin(users, eq(users.id, appealNotes.authorId))
    .where(eq(appealNotes.appealId, appealId))
    .orderBy(desc(appealNotes.createdAt));

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
    .where(and(eq(auditEvents.entityType, "appeal"), eq(auditEvents.entityId, appealId)))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(20);

  return { ...row, deniedLine, notes, activity };
}

export type AppealDetail = NonNullable<Awaited<ReturnType<typeof getAppeal>>>;

/** Appeals already open for a denial (a denial already under appeal offers no "Start appeal" link). */
export async function openAppealsForDenial(tx: TenantTx, denialId: string) {
  return tx
    .select({ id: appeals.id, status: appeals.status })
    .from(appeals)
    .where(and(eq(appeals.denialId, denialId), inArray(appeals.status, APPEAL_OPEN_STATUSES)));
}

export type { AppealStatus };
