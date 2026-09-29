import type { JobDispatch } from "@/domain/integrations/sync";
import { syntheticDataOnly } from "@/lib/env";
import { log } from "@/lib/log";
import { netlifyWorkerUrl } from "@/platform/netlify/jobs";
import { httpJobSender } from "./dispatch";
import { jobSecret, JobSecretError } from "./signature";

// Which way Sync now and the scheduler send a job in this environment (ADR 0012). The one place the
// platform adapter's worker URL meets the platform-neutral sender; Azure adds its own URL here.

type Env = Record<string, string | undefined>;

/** The worker URL for this environment, or `null` when there is none (local development, tests). */
export function workerUrl(env: Env = process.env): string | null {
  return netlifyWorkerUrl(env);
}

export type JobsConfigProblem = "missing_secret" | "weak_secret" | "no_worker_url";

/** What is wrong with the job configuration, or `null` when jobs are fully configured. Never reads a value out. */
export function jobsConfigProblem(env: Env = process.env): JobsConfigProblem | null {
  if (!env.INTEGRATION_JOB_SECRET) return "missing_secret";
  try {
    jobSecret(env);
  } catch (error) {
    if (error instanceof JobSecretError) return "weak_secret";
    throw error;
  }
  return workerUrl(env) ? null : "no_worker_url";
}

/**
 * How Sync now runs a press here (`SyncDeps.jobs`):
 * - jobs fully configured: `send` a signed job to the worker;
 * - a secret that is set but too short: `refused` (never quietly run in the request, so a weak secret can't be
 *   mistaken for a working setup);
 * - anything else missing (no secret, or no worker URL): where only synthetic data is allowed (tests, local
 *   development, pre-production not yet set up) `undefined`, meaning run in the request as before; **where real
 *   data is allowed, `refused`**: unattended, long work must not run inside a request there (security review L4).
 */
export function syncNowJobs(
  env: Env = process.env,
  synthetic: () => boolean = syntheticDataOnly,
): JobDispatch | undefined {
  const problem = jobsConfigProblem(env);
  if (problem === null)
    return { kind: "send", send: httpJobSender({ url: workerUrl(env)!, secret: jobSecret(env) }) };
  if (problem === "weak_secret") {
    log.error("integration.job_refused", { status: problem });
    return { kind: "refused" };
  }
  return synthetic() ? undefined : { kind: "refused" };
}

/**
 * Logged once at boot (src/instrumentation.ts): where real data is allowed and jobs are not fully
 * configured, Sync now refuses every press. A code, no value.
 */
export function logJobsConfigAtBoot(
  env: Env = process.env,
  synthetic: () => boolean = syntheticDataOnly,
): void {
  const problem = jobsConfigProblem(env);
  if (problem === "weak_secret" || (problem !== null && !synthetic())) {
    log.error("integrations.jobs_not_configured", { status: problem });
  }
}

/** The scheduler's sender: needs both the secret (checked by the scheduler) and a worker URL. */
export function scheduledSender(secret: Buffer, env: Env = process.env) {
  const url = workerUrl(env);
  return url ? httpJobSender({ url, secret }) : null;
}
