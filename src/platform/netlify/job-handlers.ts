import { scheduledSender } from "@/integrations/jobs/default-sender";
import { runScheduledSync } from "@/integrations/jobs/scheduler";
import { MAX_JOB_BODY_BYTES } from "@/integrations/jobs/signature";
import { productionSyncDeps } from "@/integrations/jobs/sync-deps";
import { handleSyncJob, type JobResponse } from "@/integrations/jobs/worker";

// The Netlify adapter for background jobs (ADR 0003, ADR 0012): request/response plumbing only. The
// function files in netlify/functions/ (thin, because Netlify reads their `config` statically) call
// these; the logic is in src/integrations/jobs and knows nothing about Netlify. Pre-production only:
// Netlify is not the HIPAA host, and only sandbox connections can run there.

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Background Function: `netlify/functions/integration-sync-background.ts`. Netlify has already answered 202 by the time this finishes. */
export async function syncJobFunction(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_JOB_BODY_BYTES) return json({ error: "too_large" }, 413);
  const outcome: JobResponse = await handleSyncJob(
    { body: request.body, headers: request.headers },
    { sync: productionSyncDeps() },
  );
  return json(
    outcome.code === "done" ? { status: outcome.runStatus } : { error: outcome.code },
    outcome.status,
  );
}

/** Scheduled Function: `netlify/functions/integration-sync-scheduler.ts`, every 15 minutes (OA-056). */
export async function scheduledSyncFunction(): Promise<Response> {
  const result = await runScheduledSync({ sender: (secret) => scheduledSender(secret) });
  return json(result, result.status === "ok" ? 200 : 503);
}
