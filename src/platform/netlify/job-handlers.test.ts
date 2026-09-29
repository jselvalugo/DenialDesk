import { beforeEach, describe, expect, it, vi } from "vitest";

// The Netlify adapter is request/response plumbing only (ADR 0003, ADR 0012): method check, the early
// Content-Length refusal, and the mapping of the worker's and the scheduler's answers to HTTP. The logic is
// tested where it lives (src/integrations/jobs). Synthetic values only.

const handleSyncJob = vi.hoisted(() => vi.fn());
const runScheduledSync = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/jobs/worker", () => ({ handleSyncJob }));
vi.mock("@/integrations/jobs/scheduler", () => ({ runScheduledSync }));
vi.mock("@/integrations/jobs/sync-deps", () => ({ productionSyncDeps: () => ({ marker: "deps" }) }));

const { scheduledSyncFunction, syncJobFunction } = await import("./job-handlers");

const url = "https://deploy-1--denialdesk.netlify.app/.netlify/functions/integration-sync-background";
const post = (init: RequestInit = {}) => new Request(url, { method: "POST", body: "{}", ...init });

beforeEach(() => {
  handleSyncJob.mockReset();
  runScheduledSync.mockReset();
});

describe("syncJobFunction", () => {
  it("answers 405 to anything but POST, without touching the worker", async () => {
    for (const method of ["GET", "PUT", "DELETE"]) {
      const response = await syncJobFunction(new Request(url, { method }));
      expect(response.status, method).toBe(405);
      expect(await response.json()).toEqual({ error: "method_not_allowed" });
    }
    expect(handleSyncJob).not.toHaveBeenCalled();
  });

  it("answers 413 at once when Content-Length already says the body is over the cap", async () => {
    const response = await syncJobFunction(post({ headers: { "content-length": "2048" } }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "too_large" });
    expect(handleSyncJob).not.toHaveBeenCalled();
  });

  it("hands the worker the request's byte stream and headers (the worker enforces the cap while reading) and this deploy's wiring", async () => {
    handleSyncJob.mockResolvedValue({ status: 200, code: "done", runStatus: "succeeded" });
    const request = post({ headers: { "x-denialdesk-job-timestamp": "1" } });
    await syncJobFunction(request);
    const [jobRequest, deps] = handleSyncJob.mock.calls[0] as [{ body: unknown; headers: Headers }, unknown];
    expect(jobRequest.body).toBe(request.body);
    expect(jobRequest.headers.get("x-denialdesk-job-timestamp")).toBe("1");
    expect(deps).toEqual({ sync: { marker: "deps" } });
  });

  it.each([
    [{ status: 200, code: "done", runStatus: "succeeded" }, 200, { status: "succeeded" }],
    [{ status: 200, code: "done", runStatus: "failed" }, 200, { status: "failed" }],
    [{ status: 401, code: "unauthorized" }, 401, { error: "unauthorized" }],
    [{ status: 400, code: "bad_request" }, 400, { error: "bad_request" }],
    [{ status: 409, code: "not_claimable" }, 409, { error: "not_claimable" }],
    [{ status: 413, code: "too_large" }, 413, { error: "too_large" }],
    [{ status: 503, code: "unavailable" }, 503, { error: "unavailable" }],
    [{ status: 500, code: "internal_error" }, 500, { error: "internal_error" }],
  ])("maps the worker's answer %j to HTTP %i with only a fixed word", async (answer, status, body) => {
    handleSyncJob.mockResolvedValue(answer);
    const response = await syncJobFunction(post());
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual(body);
  });
});

describe("scheduledSyncFunction", () => {
  it("answers 200 with the tick's counts when it ran", async () => {
    const result = { status: "ok", queued: 2, sent: 2, failed: 0, abandoned: 0, unsent: 0 };
    runScheduledSync.mockResolvedValue(result);
    const response = await scheduledSyncFunction();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
  });

  it("answers 503 when the scheduler refused (no secret, or no worker URL)", async () => {
    const result = { status: "refused", queued: 0, sent: 0, failed: 0, abandoned: 0, unsent: 0 };
    runScheduledSync.mockResolvedValue(result);
    const response = await scheduledSyncFunction();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(result);
  });
});
