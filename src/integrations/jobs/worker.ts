import { claimQueuedRun, type ClaimedRun } from "@/domain/integrations/job-runs";
import {
  executeSyncRun,
  SyncRunNotQueuedError,
  type SyncDeps,
  type SyncRunResult,
} from "@/domain/integrations/sync";
import { log } from "@/lib/log";
import {
  jobSecret,
  JobSecretError,
  MAX_JOB_BODY_BYTES,
  verifyJob,
  type HeaderReader,
  type JobRefusal,
} from "./signature";

// The platform-neutral job worker (docs/specs/patient-integrations.md "PI2b" Jobs; ADR 0012; threat model
// S5). Netlify's Background Function (src/platform/netlify) and, at the Azure cutover, a worker container
// call `handleSyncJob` with the raw body and headers of the request; nothing here knows either platform.
//
// A job is trusted only after its HMAC verifies. The signature proves who sent it, never what the run is:
// the run is then claimed through `integration_claim_run` (a queued run of an active connection, the
// tenant taken from the database, never from the job), and executed by the same `executeSyncRun` Sync now
// used to call inline, under `withTenantAsSystem`. Every refusal is logged as a code and, where a run is
// known, its ID; a job carries nothing else, and nothing here reads a patient.

export interface JobRequest {
  /**
   * The raw body: a string already read, or the request's byte stream. A stream is read here, counting bytes and
   * stopping at `MAX_JOB_BODY_BYTES + 1`, so an oversized or endless body is never buffered whatever
   * `Content-Length` says (or omits): the cap lives in the platform-neutral worker, so Azure gets it too.
   */
  body: string | ReadableStream<Uint8Array> | null;
  headers: HeaderReader;
}

/** The body as text, or `null` if it is longer than `MAX_JOB_BODY_BYTES` (reading stops at the first byte over). */
export async function readJobBody(body: JobRequest["body"]): Promise<string | null> {
  if (body === null) return "";
  if (typeof body === "string") {
    return Buffer.byteLength(body, "utf8") > MAX_JOB_BODY_BYTES ? null : body;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_JOB_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** What the worker answers. `code` is a fixed word; there is never a message, an ID, or a stack. */
export interface JobResponse {
  status: 200 | 400 | 401 | 409 | 413 | 500 | 503;
  code:
    | "done"
    | "unauthorized"
    | "bad_request"
    | "not_claimable"
    | "too_large"
    | "unavailable"
    | "internal_error";
  /** Only for `done`: how the run ended. */
  runStatus?: SyncRunResult["status"];
}

export interface JobWorkerDeps {
  /** What a run executes on (transport, key store). */
  sync: SyncDeps;
  /** Defaults to `jobSecret()` (the environment); a missing or short secret answers 503. */
  secret?: () => Buffer;
  now?: () => Date;
  claim?: (runId: string) => Promise<ClaimedRun | null>;
  execute?: typeof executeSyncRun;
}

const refusalStatus: Record<JobRefusal, JobResponse> = {
  // One answer for everything that fails before the signature is proven: the caller learns nothing
  // about which check it failed.
  unsigned: { status: 401, code: "unauthorized" },
  bad_timestamp: { status: 401, code: "unauthorized" },
  stale: { status: 401, code: "unauthorized" },
  bad_signature: { status: 401, code: "unauthorized" },
  too_large: { status: 413, code: "too_large" },
  bad_payload: { status: 400, code: "bad_request" },
};

export async function handleSyncJob(request: JobRequest, deps: JobWorkerDeps): Promise<JobResponse> {
  let secret: Buffer;
  try {
    secret = (deps.secret ?? jobSecret)();
  } catch (error) {
    if (!(error instanceof JobSecretError)) throw error;
    // Refuses to run, whatever arrives: without a proper secret nothing can be verified.
    log.error("integration.job_refused", { status: error.code });
    return { status: 503, code: "unavailable" };
  }

  const body = await readJobBody(request.body);
  if (body === null) {
    log.warn("integration.job_refused", { status: "too_large" });
    return refusalStatus.too_large;
  }
  const verified = verifyJob(secret, body, request.headers, deps.now?.());
  if (!verified.ok) {
    log.warn("integration.job_refused", { status: verified.refusal });
    return refusalStatus[verified.refusal];
  }
  const { runId } = verified;

  try {
    const claimed = await (deps.claim ?? claimQueuedRun)(runId);
    if (!claimed) {
      // A made-up run ID, one already running or finished (a replay or a second worker), or a connection
      // that is no longer active: indistinguishable to the caller and to an attacker holding a valid MAC.
      log.warn("integration.job_refused", { status: "not_claimable", runId });
      return { status: 409, code: "not_claimable" };
    }
    const result = await (deps.execute ?? executeSyncRun)({ tenantId: claimed.tenantId, runId }, deps.sync);
    return { status: 200, code: "done", runStatus: result.status };
  } catch (error) {
    // Another worker moved the run to `running` between the claim check and this run's own atomic claim.
    if (error instanceof SyncRunNotQueuedError) {
      log.warn("integration.job_refused", { status: "not_claimable", runId });
      return { status: 409, code: "not_claimable" };
    }
    // The class name only: a message could carry a value.
    log.error("integration.job_failed", {
      runId,
      errorName:
        error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? error.name : "Error",
    });
    return { status: 500, code: "internal_error" };
  }
}
