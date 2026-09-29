import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncRunNotQueuedError, type SyncDeps, type SyncRunResult } from "@/domain/integrations/sync";
import { JOB_SIGNATURE_HEADER, JOB_TIMESTAMP_HEADER, jobBodyFor, signJob } from "./signature";
import { handleSyncJob, type JobWorkerDeps } from "./worker";

// docs/specs/patient-integrations.md PI2b "Jobs": the worker refuses an unsigned call, a stale timestamp, a
// bad signature, a forged run ID, and an already-claimed run ID; the run only executes after all of that.
// Unit level, with the database claim and the engine stubbed: the database end is in
// test/integration/jobs-worker.test.ts. Synthetic values only.

const secret = Buffer.from("synthetic".repeat(5), "utf8");
const runId = "3f2b8a7e-9c1d-4e5f-8a6b-7c8d9e0f1a2b";
const tenantId = "8a1c5d2e-4b3f-4a6c-9d7e-0f1a2b3c4d5e";
const connectionId = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";
const now = new Date("2026-09-29T12:00:00Z");

const headersOf = (record: Record<string, string>) => ({
  get: (name: string) => record[name.toLowerCase()] ?? null,
});
const signed = (body = jobBodyFor(runId), at = now) => ({
  body,
  headers: headersOf(signJob(secret, body, at)),
});

const done: SyncRunResult = {
  runId,
  status: "succeeded",
  created: 1,
  updated: 0,
  linked: 0,
  unchanged: 0,
  skipped: 0,
  codes: [],
};

function deps(overrides: Partial<JobWorkerDeps> = {}) {
  const claim = vi.fn(async () => ({ tenantId, connectionId }));
  const execute = vi.fn(async () => done);
  const worker: JobWorkerDeps = {
    sync: {} as SyncDeps,
    secret: () => secret,
    now: () => now,
    claim,
    execute,
    ...overrides,
  };
  return { worker, claim, execute };
}

let stderr: ReturnType<typeof vi.spyOn> | undefined;
function captureLog() {
  const lines: string[] = [];
  stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}
afterEach(() => {
  stderr?.mockRestore();
  stderr = undefined;
});

describe("the job worker refuses", () => {
  it("an unsigned call: 401, nothing claimed, nothing run", async () => {
    captureLog();
    const { worker, claim, execute } = deps();
    const response = await handleSyncJob({ body: jobBodyFor(runId), headers: headersOf({}) }, worker);
    expect(response).toEqual({ status: 401, code: "unauthorized" });
    expect(claim).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("a stale timestamp: 401 (one minute past the window), nothing claimed", async () => {
    captureLog();
    const { worker, claim, execute } = deps();
    const stale = new Date(now.getTime() - (5 * 60 + 1) * 1000);
    expect(await handleSyncJob(signed(jobBodyFor(runId), stale), worker)).toEqual({
      status: 401,
      code: "unauthorized",
    });
    expect(claim).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("a bad signature (wrong secret, or altered header): the same 401 as unsigned, so the caller learns nothing", async () => {
    captureLog();
    const { worker, claim, execute } = deps();
    const body = jobBodyFor(runId);
    const wrongKey = signJob(Buffer.from("x".repeat(40)), body, now);
    expect(await handleSyncJob({ body, headers: headersOf(wrongKey) }, worker)).toEqual({
      status: 401,
      code: "unauthorized",
    });
    const good = signJob(secret, body, now);
    const altered = { ...good, [JOB_SIGNATURE_HEADER]: `v1=${"0".repeat(64)}` };
    expect(await handleSyncJob({ body, headers: headersOf(altered) }, worker)).toEqual({
      status: 401,
      code: "unauthorized",
    });
    const shifted = { ...good, [JOB_TIMESTAMP_HEADER]: String(Math.floor(now.getTime() / 1000) + 1) };
    expect((await handleSyncJob({ body, headers: headersOf(shifted) }, worker)).status).toBe(401);
    expect(claim).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("a signed payload that is not exactly `{ runId }`: 400, nothing claimed", async () => {
    captureLog();
    const { worker, claim } = deps();
    const body = `{"runId":"${runId}","tenantId":"${tenantId}"}`;
    expect(await handleSyncJob(signed(body), worker)).toEqual({ status: 400, code: "bad_request" });
    expect(claim).not.toHaveBeenCalled();
  });

  it("a forged run ID (correctly signed, but no such queued run): 409 and nothing runs", async () => {
    const lines = captureLog();
    const { worker, execute } = deps({ claim: vi.fn(async () => null) });
    expect(await handleSyncJob(signed(), worker)).toEqual({ status: 409, code: "not_claimable" });
    expect(execute).not.toHaveBeenCalled();
    // Logged as a code and the run ID, nothing else.
    expect(lines.join("")).toContain('"event":"integration.job_refused"');
    expect(lines.join("")).toContain(`"runId":"${runId}"`);
    expect(lines.join("")).not.toContain(tenantId);
  });

  it("an already-claimed run ID (another worker took it between the check and the run): 409", async () => {
    captureLog();
    const { worker } = deps({
      execute: vi.fn(async () => {
        throw new SyncRunNotQueuedError();
      }),
    });
    expect(await handleSyncJob(signed(), worker)).toEqual({ status: 409, code: "not_claimable" });
  });

  it("everything while the secret is missing or too short: 503, whatever arrives", async () => {
    captureLog();
    for (const env of [{}, { INTEGRATION_JOB_SECRET: "short" }]) {
      const { worker, claim, execute } = deps({ secret: undefined });
      const previous = process.env.INTEGRATION_JOB_SECRET;
      delete process.env.INTEGRATION_JOB_SECRET;
      Object.assign(process.env, env);
      try {
        expect(await handleSyncJob(signed(), worker)).toEqual({ status: 503, code: "unavailable" });
      } finally {
        if (previous === undefined) delete process.env.INTEGRATION_JOB_SECRET;
        else process.env.INTEGRATION_JOB_SECRET = previous;
      }
      expect(claim).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    }
  });
});

describe("the job worker runs", () => {
  it("a valid job: claims, then executes the run in the tenant the database named, never one from the job", async () => {
    const { worker, claim, execute } = deps();
    const response = await handleSyncJob(signed(), worker);
    expect(response).toEqual({ status: 200, code: "done", runStatus: "succeeded" });
    expect(claim).toHaveBeenCalledWith(runId);
    expect(execute).toHaveBeenCalledWith({ tenantId, runId }, worker.sync);
  });

  it("an unexpected failure is a 500 with a class name in the log and no message", async () => {
    const lines = captureLog();
    const { worker } = deps({
      execute: vi.fn(async () => {
        throw new Error("Jane Synthetic, MRN SYN-123 could not be saved");
      }),
    });
    expect(await handleSyncJob(signed(), worker)).toEqual({ status: 500, code: "internal_error" });
    const output = lines.join("");
    expect(output).toContain('"event":"integration.job_failed"');
    expect(output).toContain('"errorName":"Error"');
    expect(output).not.toContain("Jane");
    expect(output).not.toContain("SYN-123");
  });
});
