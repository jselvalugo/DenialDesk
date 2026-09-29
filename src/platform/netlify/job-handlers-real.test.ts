import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_JOB_BODY_BYTES } from "@/integrations/jobs/signature";
import { scheduledSyncFunction, syncJobFunction } from "./job-handlers";

// The adapter against the real worker and scheduler (nothing mocked), for the paths that don't reach the
// database: the body cap on a chunked body with no Content-Length, and the refusals without a secret.
// Synthetic values only.

const url = "https://deploy-1--denialdesk.netlify.app/.netlify/functions/integration-sync-background";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** A POST whose body is a stream: no Content-Length is sent, as with chunked transfer encoding. */
function chunked(chunks: Uint8Array[]): Request {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) return controller.close();
      controller.enqueue(chunks[index]!);
      index += 1;
    },
  });
  return new Request(url, { method: "POST", body, duplex: "half" } as RequestInit);
}

describe("the body cap on a chunked body with no Content-Length (security review L1)", () => {
  it("refuses a body over the cap with 413, reading no further than the first byte over", async () => {
    vi.stubEnv("INTEGRATION_JOB_SECRET", "synthetic".repeat(5));
    const request = chunked([new Uint8Array(MAX_JOB_BODY_BYTES).fill(97), new Uint8Array(1).fill(97)]);
    expect(request.headers.get("content-length")).toBeNull();
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const response = await syncJobFunction(request);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "too_large" });
  });

  it("a body inside the cap goes on to the signature check (an unsigned one is a 401)", async () => {
    vi.stubEnv("INTEGRATION_JOB_SECRET", "synthetic".repeat(5));
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const response = await syncJobFunction(chunked([new TextEncoder().encode("{}")]));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
});

describe("without a proper secret", () => {
  it("the worker answers 503 and the scheduler answers 503 having queued nothing", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    for (const value of ["", "short"]) {
      vi.stubEnv("INTEGRATION_JOB_SECRET", value);
      const worker = await syncJobFunction(chunked([new TextEncoder().encode("{}")]));
      expect(worker.status, value).toBe(503);
      expect(await worker.json()).toEqual({ error: "unavailable" });
      const scheduler = await scheduledSyncFunction();
      expect(scheduler.status, value).toBe(503);
      expect(await scheduler.json()).toMatchObject({ status: "refused", queued: 0, sent: 0 });
    }
  });
});
