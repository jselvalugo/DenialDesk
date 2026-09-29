import { enqueueDueRuns } from "@/domain/integrations/job-runs";
import { log } from "@/lib/log";
import type { JobSender } from "./dispatch";
import { jobSecret, JobSecretError } from "./signature";

// The scheduled sync (docs/specs/patient-integrations.md "PI3", OA-056; ADR 0012). Platform-neutral: the
// Netlify Scheduled Function every 15 minutes, or an Azure timer later, calls `runScheduledSync`. It asks the
// database to queue a run for every due active connection (`integration_enqueue_due_runs`, which returns
// run IDs and nothing else) and posts one signed job per run ID. It never opens a practice's data and
// never executes a run itself: a scheduled function has about 30 seconds, a sync up to 12 minutes.

export interface ScheduledSyncDeps {
  /** Defaults to `jobSecret()`; checked before anything is queued. */
  secret?: () => Buffer;
  /** Builds the sender for this tick (URL and secret); `null` when no worker URL is configured. */
  sender: (secret: Buffer) => JobSender | null;
  enqueue?: () => Promise<string[]>;
  /** How many jobs are in flight at once. */
  concurrency?: number;
}

export interface ScheduledSyncResult {
  status: "ok" | "refused";
  queued: number;
  sent: number;
  failed: number;
}

const DEFAULT_CONCURRENCY = 8;

export async function runScheduledSync(deps: ScheduledSyncDeps): Promise<ScheduledSyncResult> {
  let secret: Buffer;
  try {
    secret = (deps.secret ?? jobSecret)();
  } catch (error) {
    if (!(error instanceof JobSecretError)) throw error;
    // Nothing is queued when nothing could be sent: a queued run nobody runs only blocks the connection
    // until its lease ends.
    log.error("integration.schedule_refused", { status: error.code });
    return { status: "refused", queued: 0, sent: 0, failed: 0 };
  }
  const send = deps.sender(secret);
  if (!send) {
    log.error("integration.schedule_refused", { status: "no_worker_url" });
    return { status: "refused", queued: 0, sent: 0, failed: 0 };
  }

  const runIds = await (deps.enqueue ?? enqueueDueRuns)();
  let sent = 0;
  let failed = 0;
  const width = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY);
  for (let start = 0; start < runIds.length; start += width) {
    const outcomes = await Promise.all(runIds.slice(start, start + width).map((runId) => send(runId)));
    for (const ok of outcomes) {
      if (ok) sent += 1;
      else failed += 1;
    }
  }
  // A run whose job was lost stays `queued` until the 20-minute lease ends; the next tick after that
  // abandons it and queues a fresh one (drizzle/0044).
  log.info("integration.schedule_ran", { count: runIds.length, status: failed === 0 ? "ok" : "partial" });
  return { status: "ok", queued: runIds.length, sent, failed };
}
