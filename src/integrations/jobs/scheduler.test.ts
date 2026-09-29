import { afterEach, describe, expect, it, vi } from "vitest";
import { runScheduledSync } from "./scheduler";

// PI3: the scheduled tick queues runs and posts one signed job per run ID. Unit level, the database
// function stubbed (its behavior is in test/integration/jobs-db.test.ts). Synthetic values only.

const secret = Buffer.from("synthetic".repeat(5), "utf8");
const ids = [
  "3f2b8a7e-9c1d-4e5f-8a6b-7c8d9e0f1a2b",
  "4a3c9b8f-0d2e-4f60-9b7c-8d9e0f1a2b3c",
  "5b4dac9a-1e3f-4071-8c8d-9e0f1a2b3c4d",
];

let stderr: ReturnType<typeof vi.spyOn> | undefined;
afterEach(() => stderr?.mockRestore());
function quiet() {
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
}

describe("runScheduledSync", () => {
  it("queues, then posts one job per run ID and counts what was sent and what failed", async () => {
    const sent: string[] = [];
    const enqueue = vi.fn(async () => ids);
    const result = await runScheduledSync({
      secret: () => secret,
      enqueue,
      sender: () => async (runId) => {
        sent.push(runId);
        return runId !== ids[1];
      },
      concurrency: 2,
    });
    expect(sent.sort()).toEqual([...ids].sort());
    expect(result).toEqual({ status: "ok", queued: 3, sent: 2, failed: 1 });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("does nothing when nothing is due", async () => {
    const result = await runScheduledSync({
      secret: () => secret,
      enqueue: async () => [],
      sender: () => async () => true,
    });
    expect(result).toEqual({ status: "ok", queued: 0, sent: 0, failed: 0 });
  });

  it("refuses, before queueing anything, when the secret is missing or too short", async () => {
    quiet();
    for (const value of [undefined, "short"]) {
      const enqueue = vi.fn(async () => ids);
      const previous = process.env.INTEGRATION_JOB_SECRET;
      if (value === undefined) delete process.env.INTEGRATION_JOB_SECRET;
      else process.env.INTEGRATION_JOB_SECRET = value;
      try {
        const result = await runScheduledSync({ enqueue, sender: () => async () => true });
        expect(result).toEqual({ status: "refused", queued: 0, sent: 0, failed: 0 });
      } finally {
        if (previous === undefined) delete process.env.INTEGRATION_JOB_SECRET;
        else process.env.INTEGRATION_JOB_SECRET = previous;
      }
      expect(enqueue).not.toHaveBeenCalled();
    }
  });

  it("refuses, before queueing anything, when there is no worker to send to", async () => {
    quiet();
    const enqueue = vi.fn(async () => ids);
    const result = await runScheduledSync({ secret: () => secret, enqueue, sender: () => null });
    expect(result.status).toBe("refused");
    expect(enqueue).not.toHaveBeenCalled();
  });
});
