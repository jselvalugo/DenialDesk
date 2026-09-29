import { log } from "@/lib/log";
import { jobBodyFor, signJob } from "./signature";

// Sending a job (docs/specs/patient-integrations.md "PI2b" Jobs and "PI3"; ADR 0012). Platform-neutral:
// a signed POST of `{ runId }` to a worker URL. Sync now and the scheduled function both use it; the
// worker URL comes from the environment (`INTEGRATION_JOB_URL`, or the platform adapter's default), never
// from a request, so a forged Host header can't redirect a signed job somewhere else.

export type JobSender = (runId: string) => Promise<boolean>;

export interface HttpJobSenderOptions {
  url: string;
  secret: Buffer;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

/** Long enough for a cold start; short enough that the scheduler's 30-second limit holds for a batch. */
const DEFAULT_SEND_TIMEOUT_MS = 10_000;

/** https only, except a machine-local address for `netlify dev` / a local worker. No credentials, no query. */
export function isAcceptableWorkerUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.search || url.hash) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/**
 * A sender that POSTs the signed job. Resolves `true` when the worker accepted it (any 2xx: a Netlify
 * Background Function answers 202 at once), `false` for a refusal, a timeout, or a network error. It never
 * follows a redirect (a signed job must not travel to a place nobody configured) and logs the outcome as
 * a code with the run ID, never the URL, the body, or a header.
 */
export function httpJobSender(options: HttpJobSenderOptions): JobSender {
  if (!isAcceptableWorkerUrl(options.url)) throw new Error("The job worker URL must be https");
  const send = options.fetch ?? fetch;
  return async (runId) => {
    const body = jobBodyFor(runId);
    try {
      const response = await send(options.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...signJob(options.secret, body, options.now?.()) },
        body,
        redirect: "error",
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS),
      });
      if (response.status >= 200 && response.status < 300) return true;
      log.warn("integration.job_send_failed", { runId, status: `http_${response.status}` });
      return false;
    } catch {
      log.warn("integration.job_send_failed", { runId, status: "network" });
      return false;
    }
  };
}
