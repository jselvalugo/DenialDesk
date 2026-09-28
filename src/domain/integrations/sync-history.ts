import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { integrationSyncIssues, integrationSyncRuns } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { MessageKey } from "@/i18n/messages/types";
import type { IntegrationActor, SyncRunStatus } from "./connections";

// Sync history (docs/specs/patient-integrations.md PI2b, "Sync history"): what each sync run of a
// connection did, as counts and codes. Runs and issues are Internal data (spec "Classification"), and
// the selects below name their columns: the page can only ever show what is listed here. There is no
// resource content, no external ID, no URL, no name, and no free text: a run holds counts, a status,
// timestamps, an HTTP status code, and issue codes from a fixed vocabulary (CHECK
// `^[a-z_]{1,64}$`); an issue row holds a code and, when the record became a patient, that patient's
// DenialDesk ID (an opaque UUID the page links to). Reads only: the sync engine writes these tables.
// Scoped to the practice by row-level security and to the connection by every WHERE clause.

/** Label keys (`integrations` namespace) and badge tones for a run's status. */
export const SYNC_RUN_STATUS_LABEL_KEYS = {
  queued: "runs.status.queued",
  running: "runs.status.running",
  succeeded: "runs.status.succeeded",
  failed: "runs.status.failed",
  abandoned: "runs.status.abandoned",
} as const satisfies Record<SyncRunStatus, MessageKey<"integrations">>;

export const SYNC_RUN_STATUS_TONE = {
  queued: "neutral",
  running: "info",
  succeeded: "success",
  failed: "danger",
  abandoned: "warning",
} as const satisfies Record<SyncRunStatus, "neutral" | "info" | "success" | "warning" | "danger">;

export const SYNC_RUNS_PAGE_SIZE = 25;
/** The most issue rows one run's detail lists. */
export const MAX_SYNC_ISSUES_SHOWN = 200;

export interface SyncRunRow {
  id: string;
  /** "manual" (Sync now) or "scheduled". */
  trigger: string;
  status: SyncRunStatus;
  queuedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdCount: number;
  updatedCount: number;
  linkedCount: number;
  skippedCount: number;
  /** Codes only (fixed vocabulary and R4 IssueType codes), never `diagnostics`. */
  issueCodes: string[];
  /** The last HTTP status the run saw, as a code. */
  httpStatus: number | null;
  /** How many issue rows the run recorded. */
  issueCount: number;
}

/**
 * One page of a connection's runs, newest first, and how many runs it has in all. A page past the end
 * (a stale link, a hand-edited address) is clamped to the last page, so the result never has runs
 * hidden behind an empty page: `page` is the page actually returned.
 */
export async function listSyncRuns(
  tx: TenantTx,
  connectionId: string,
  page: number,
  pageSize: number = SYNC_RUNS_PAGE_SIZE,
): Promise<{ runs: SyncRunRow[]; total: number; page: number }> {
  const [counted] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(integrationSyncRuns)
    .where(eq(integrationSyncRuns.connectionId, connectionId));
  const total = counted?.total ?? 0;
  const shownPage = Math.min(Math.max(1, page), Math.max(1, Math.ceil(total / pageSize)));
  const rows = await tx
    .select({
      id: integrationSyncRuns.id,
      trigger: integrationSyncRuns.trigger,
      status: integrationSyncRuns.status,
      queuedAt: integrationSyncRuns.queuedAt,
      startedAt: integrationSyncRuns.startedAt,
      finishedAt: integrationSyncRuns.finishedAt,
      createdCount: integrationSyncRuns.createdCount,
      updatedCount: integrationSyncRuns.updatedCount,
      linkedCount: integrationSyncRuns.linkedCount,
      skippedCount: integrationSyncRuns.skippedCount,
      issueCodes: integrationSyncRuns.issueCodes,
      httpStatus: integrationSyncRuns.httpStatus,
    })
    .from(integrationSyncRuns)
    .where(eq(integrationSyncRuns.connectionId, connectionId))
    .orderBy(desc(integrationSyncRuns.queuedAt), desc(integrationSyncRuns.id))
    .limit(pageSize)
    .offset((shownPage - 1) * pageSize);
  const issueCounts =
    rows.length === 0
      ? []
      : await tx
          .select({ runId: integrationSyncIssues.runId, count: sql<number>`count(*)::int` })
          .from(integrationSyncIssues)
          .where(
            inArray(
              integrationSyncIssues.runId,
              rows.map((row) => row.id),
            ),
          )
          .groupBy(integrationSyncIssues.runId);
  const countOf = new Map(issueCounts.map((row) => [row.runId, row.count]));
  return {
    runs: rows.map((row) => ({ ...row, issueCount: countOf.get(row.id) ?? 0 })),
    total,
    page: shownPage,
  };
}

/** One recorded issue: a code and, when the record became a patient, that patient's DenialDesk ID. */
export interface SyncIssueRow {
  id: string;
  code: string;
  /** The DenialDesk patient the issue is about (the page links to it), or null. Never an external ID. */
  patientId: string | null;
  createdAt: Date;
}

/**
 * The issues of one run of this connection, oldest first, or null when the run isn't one of this
 * connection's (another connection's or practice's run ID is "not found", never listed). Bounded by
 * `MAX_SYNC_ISSUES_SHOWN`; `truncated` says there were more.
 */
export async function getSyncRunIssues(
  tx: TenantTx,
  connectionId: string,
  runId: string,
): Promise<{ issues: SyncIssueRow[]; truncated: boolean } | null> {
  const [run] = await tx
    .select({ id: integrationSyncRuns.id })
    .from(integrationSyncRuns)
    .where(and(eq(integrationSyncRuns.id, runId), eq(integrationSyncRuns.connectionId, connectionId)));
  if (!run) return null;
  const rows = await tx
    .select({
      id: integrationSyncIssues.id,
      code: integrationSyncIssues.code,
      patientId: integrationSyncIssues.patientId,
      createdAt: integrationSyncIssues.createdAt,
    })
    .from(integrationSyncIssues)
    .where(eq(integrationSyncIssues.runId, runId))
    .orderBy(asc(integrationSyncIssues.createdAt), asc(integrationSyncIssues.id))
    .limit(MAX_SYNC_ISSUES_SHOWN + 1);
  return { issues: rows.slice(0, MAX_SYNC_ISSUES_SHOWN), truncated: rows.length > MAX_SYNC_ISSUES_SHOWN };
}

/**
 * Records that an administrator opened one run's issue rows: the connection, the run, and how many
 * rows were shown (IDs and a count, never a code list or a patient ID). The rows are per-patient
 * records, so the read is audited (R-7.5.1); the run list, which holds counts and codes only, is not.
 * `reason` is a fixed code; `session_id` ties the read to the session that made it.
 */
export async function auditSyncRunViewed(
  tx: TenantTx,
  actor: Pick<IntegrationActor, "tenantId" | "userId" | "sessionId">,
  connectionId: string,
  runId: string,
  rowCount: number,
): Promise<void> {
  await audit(tx, {
    action: "integration.sync_run_viewed",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "integration_sync_run",
    entityId: runId,
    reason: "sync_history",
    metadata: { connection_id: connectionId, row_count: rowCount, session_id: actor.sessionId ?? null },
  });
}
