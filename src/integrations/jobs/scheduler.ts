import { randomInt } from "node:crypto";
import {
  abandonUnsentRun,
  auditLeaseAbandonedRun,
  enqueueDueRuns,
  type EnqueuedRun,
} from "@/domain/integrations/job-runs";
import { SCHEDULED_SANDBOX_ONLY } from "@/domain/integrations/sync";
import { log } from "@/lib/log";
import { DEFAULT_SEND_TIMEOUT_MS, type JobSender } from "./dispatch";
import { jobSecret, JobSecretError } from "./signature";

// The scheduled sync (docs/specs/patient-integrations.md "PI3", OA-056; ADR 0012). Platform-neutral: the
// Netlify Scheduled Function every 15 minutes, or an Azure timer later, calls `runScheduledSync`. It asks the
// database to queue a run for every due active connection (`integration_enqueue_due_runs`, which returns
// run IDs and what it did) and posts one signed job per queued run. It never opens a practice's data beyond
// the audit rows below and never executes a run itself: a scheduled function has about 30 seconds, a sync up
// to 12 minutes.
//
// What it audits (`integration.sync_abandoned`, as the integration service principal): a run the database gave up
// on for going quiet past the lease (`lease_expired`), a run whose job could not be posted (`job_not_sent`),
// and, if the tick runs out of time, the runs it did not get to (`deadline`).
//
// Time: the run IDs are shuffled (so the same practices are not always the ones left over on a slow tick) and
// jobs go out `concurrency` at a time. When `deadlineMs` has passed the remaining runs are **abandoned and
// audited** rather than left queued: a queued run nobody will send would block its connection until the
// 20-minute lease ends, whereas an abandoned one that never started is not counted as recent, so the next tick
// (15 minutes on) queues that connection again.

export interface ScheduledSyncDeps {
  /** Defaults to `jobSecret()`; checked before anything is queued. */
  secret?: () => Buffer;
  /** Builds the sender for this tick (URL and secret); `null` when no worker URL is configured. */
  sender: (secret: Buffer) => JobSender | null;
  /** Defaults to the database function, sandbox connections only until PI4 (`SCHEDULED_SANDBOX_ONLY`). */
  enqueue?: () => Promise<EnqueuedRun[]>;
  auditLeaseAbandoned?: (tenantId: string, runId: string) => Promise<void>;
  abandonUnsent?: (tenantId: string, runId: string, reason: "job_not_sent" | "deadline") => Promise<boolean>;
  /** How many jobs are in flight at once (at most; default 8). */
  concurrency?: number;
  /** Stop sending this long after the tick started (default 25 s of the ~30 s a scheduled function has). */
  deadlineMs?: number;
  now?: () => number;
  /** Test hook: the default is a uniform (Fisher-Yates) shuffle. */
  shuffle?: <T>(items: T[]) => T[];
}

export interface ScheduledSyncResult {
  status: "ok" | "refused";
  /** New scheduled runs queued this tick. */
  queued: number;
  sent: number;
  /** Jobs that could not be posted (their runs were abandoned, so the next tick queues them again). */
  failed: number;
  /** Runs the database gave up on for going quiet past the lease. */
  abandoned: number;
  /** Queued runs not sent before the deadline (abandoned). */
  unsent: number;
}

export const DEFAULT_CONCURRENCY = 8;
export const DEFAULT_DEADLINE_MS = 25_000;
/** The longest one job post may take (`DEFAULT_SEND_TIMEOUT_MS` of the sender). */
export const SEND_TIMEOUT_MS = DEFAULT_SEND_TIMEOUT_MS;

const refused = (): ScheduledSyncResult => ({
  status: "refused",
  queued: 0,
  sent: 0,
  failed: 0,
  abandoned: 0,
  unsent: 0,
});

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export async function runScheduledSync(deps: ScheduledSyncDeps): Promise<ScheduledSyncResult> {
  let secret: Buffer;
  try {
    secret = (deps.secret ?? jobSecret)();
  } catch (error) {
    if (!(error instanceof JobSecretError)) throw error;
    // Nothing is queued when nothing could be sent: a queued run nobody runs only blocks the connection
    // until its lease ends.
    log.error("integration.schedule_refused", { status: error.code });
    return refused();
  }
  const send = deps.sender(secret);
  if (!send) {
    log.error("integration.schedule_refused", { status: "no_worker_url" });
    return refused();
  }

  const now = deps.now ?? Date.now;
  const startedAt = now();
  const deadline = deps.deadlineMs ?? DEFAULT_DEADLINE_MS;
  const width = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY);
  const auditLease = deps.auditLeaseAbandoned ?? auditLeaseAbandonedRun;
  const abandonUnsentRun_ = deps.abandonUnsent ?? abandonUnsentRun;

  const touched = await (deps.enqueue ?? (() => enqueueDueRuns(SCHEDULED_SANDBOX_ONLY)))();
  const gone = touched.filter((row) => row.outcome === "abandoned");
  const queued = (deps.shuffle ?? shuffled)(touched.filter((row) => row.outcome === "queued"));

  // A failure to write one audit row or abandon one run must not stop the tick (the run is retried by the lease).
  const guarded = async <T>(work: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await work();
    } catch {
      log.error("integration.schedule_audit_failed", { status: "write" });
      return undefined;
    }
  };
  /** Runs `work` for every item, `width` at a time (the same bound as the sends). */
  const inBatches = async <T>(items: T[], work: (item: T) => Promise<unknown>) => {
    for (let start = 0; start < items.length; start += width) {
      await Promise.all(items.slice(start, start + width).map((item) => guarded(() => work(item))));
    }
  };

  let sent = 0;
  let failed = 0;
  let unsent = 0;
  for (let start = 0; start < queued.length; start += width) {
    // A batch starts only if it can finish inside the deadline even if every post runs to its timeout, and each
    // post is given no more than what is left, so the tick never sends past the deadline (review: L2).
    const elapsed = now() - startedAt;
    if (elapsed + SEND_TIMEOUT_MS >= deadline) {
      const rest = queued.slice(start);
      unsent = rest.length;
      await inBatches(rest, (row) => abandonUnsentRun_(row.tenantId, row.runId, "deadline"));
      break;
    }
    const timeoutMs = Math.min(SEND_TIMEOUT_MS, deadline - elapsed);
    const outcomes = await Promise.all(
      queued.slice(start, start + width).map(async (row) => {
        const ok = await send(row.runId, { timeoutMs });
        // A job that could not be posted frees its connection at once (nobody will ever claim that run).
        if (!ok) await guarded(() => abandonUnsentRun_(row.tenantId, row.runId, "job_not_sent"));
        return ok;
      }),
    );
    for (const ok of outcomes) {
      if (ok) sent += 1;
      else failed += 1;
    }
  }

  // The lease-expired audits come last, so they can't use up the time the sends need (the runs were already
  // abandoned, and committed, by the database function: this is the record of it, best effort).
  await inBatches(gone, (row) => auditLease(row.tenantId, row.runId));

  // What an operator alerts on (runbook): a tick where some jobs could not be posted is a warning, and one where
  // none could (every post failing, so every connection is re-queued each tick without ever reaching `error`) is an error.
  const status =
    failed === 0 && unsent === 0
      ? "ok"
      : failed === queued.length && queued.length > 0
        ? "failed"
        : "partial";
  const fields = { count: queued.length, status };
  if (status === "failed") log.error("integration.schedule_ran", fields);
  else if (status === "partial") log.warn("integration.schedule_ran", fields);
  else log.info("integration.schedule_ran", fields);
  return { status: "ok", queued: queued.length, sent, failed, abandoned: gone.length, unsent };
}
