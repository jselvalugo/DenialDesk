import { log } from "@/lib/log";
import { netlifyWorkerUrl } from "@/platform/netlify/jobs";
import { httpJobSender, type JobSender } from "./dispatch";
import { jobSecret, JobSecretError } from "./signature";

// Which way Sync now and the scheduler send a job in this environment (ADR 0012). The one place the
// platform adapter's worker URL meets the platform-neutral sender; Azure adds its own URL here.

/** The worker URL for this environment, or `null` when there is none (local development, tests). */
export function workerUrl(env: Record<string, string | undefined> = process.env): string | null {
  return netlifyWorkerUrl(env);
}

/**
 * The sender Sync now uses, or `null` to run the sync in the request (local development, tests, and any
 * environment where `INTEGRATION_JOB_SECRET` is not set yet). Set but too short is not "not set": the
 * press is refused (a sender that sends nothing), never quietly run in the request, so a weak secret
 * can't be mistaken for a working setup. A secret without a worker URL (a developer's machine) runs in the request.
 */
export function syncNowSender(env: Record<string, string | undefined> = process.env): JobSender | null {
  if (!env.INTEGRATION_JOB_SECRET) return null;
  let secret: Buffer;
  try {
    secret = jobSecret(env);
  } catch (error) {
    if (!(error instanceof JobSecretError)) throw error;
    log.error("integration.job_refused", { status: error.code });
    return async () => false;
  }
  const url = workerUrl(env);
  if (!url) return null;
  return httpJobSender({ url, secret });
}

/** The scheduler's sender: needs both the secret (checked by the scheduler) and a worker URL. */
export function scheduledSender(
  secret: Buffer,
  env: Record<string, string | undefined> = process.env,
): JobSender | null {
  const url = workerUrl(env);
  return url ? httpJobSender({ url, secret }) : null;
}
