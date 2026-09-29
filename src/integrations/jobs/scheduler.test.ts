import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnqueuedRun } from "@/domain/integrations/job-runs";
import { SCHEDULED_SANDBOX_ONLY } from "@/domain/integrations/sync";
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_DEADLINE_MS,
  runScheduledSync,
  type ScheduledSyncDeps,
} from "./scheduler";

// PI3: the scheduled tick queues runs, posts one signed job per queued run, audits what the database abandoned,
// and frees a run whose job could not be posted. Unit level, the database stubbed (its behavior is in
// test/integration/jobs-db.test.ts and jobs-worker.test.ts). Synthetic values only.

const secret = Buffer.from("synthetic".repeat(5), "utf8");
const tenant = "8a1c5d2e-4b3f-4a6c-9d7e-0f1a2b3c4d5e";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const queuedRun = (n: number): EnqueuedRun => ({ tenantId: tenant, runId: uuid(n), outcome: "queued" });
const abandonedRun = (n: number): EnqueuedRun => ({ tenantId: tenant, runId: uuid(n), outcome: "abandoned" });

let stderr: ReturnType<typeof vi.spyOn> | undefined;
afterEach(() => stderr?.mockRestore());
function quiet() {
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
}

function deps(over: Partial<ScheduledSyncDeps> & { rows?: EnqueuedRun[] } = {}) {
  const { rows = [], ...rest } = over;
  const auditLeaseAbandoned = vi.fn(async () => undefined);
  const abandonUnsent = vi.fn(async () => true);
  const enqueue = vi.fn(async () => rows);
  const value: ScheduledSyncDeps = {
    secret: () => secret,
    enqueue,
    sender: () => async () => true,
    auditLeaseAbandoned,
    abandonUnsent,
    shuffle: (items) => items,
    ...rest,
  };
  return { value, auditLeaseAbandoned, abandonUnsent, enqueue };
}

describe("runScheduledSync", () => {
  it("queues, then posts one job per queued run and counts what was sent and what failed", async () => {
    quiet();
    const sent: string[] = [];
    const d = deps({
      rows: [queuedRun(1), queuedRun(2), queuedRun(3)],
      sender: () => async (runId) => {
        sent.push(runId);
        return runId !== uuid(2);
      },
      concurrency: 2,
    });
    const result = await runScheduledSync(d.value);
    expect(sent.sort()).toEqual([uuid(1), uuid(2), uuid(3)]);
    expect(result).toEqual({ status: "ok", queued: 3, sent: 2, failed: 1, abandoned: 0, unsent: 0 });
    expect(d.enqueue).toHaveBeenCalledTimes(1);
  });

  it("a run whose job could not be posted is abandoned and audited at once (job_not_sent), so its connection isn't blocked", async () => {
    quiet();
    const d = deps({ rows: [queuedRun(1), queuedRun(2)], sender: () => async (runId) => runId === uuid(1) });
    await runScheduledSync(d.value);
    expect(d.abandonUnsent).toHaveBeenCalledTimes(1);
    expect(d.abandonUnsent).toHaveBeenCalledWith(tenant, uuid(2), "job_not_sent");
  });

  it("audits each run the database abandoned (lease_expired) and sends no job for it", async () => {
    quiet();
    const sent: string[] = [];
    const d = deps({
      rows: [abandonedRun(1), queuedRun(2), abandonedRun(3)],
      sender: () => async (runId) => {
        sent.push(runId);
        return true;
      },
    });
    const result = await runScheduledSync(d.value);
    expect(d.auditLeaseAbandoned.mock.calls).toEqual([
      [tenant, uuid(1)],
      [tenant, uuid(3)],
    ]);
    expect(sent).toEqual([uuid(2)]);
    expect(result).toMatchObject({ queued: 1, sent: 1, abandoned: 2 });
  });

  it("a failing audit write or abandon doesn't stop the tick", async () => {
    quiet();
    const d = deps({
      rows: [abandonedRun(1), queuedRun(2), queuedRun(3)],
      sender: () => async (runId) => runId === uuid(2),
      auditLeaseAbandoned: async () => {
        throw new Error("db down");
      },
      abandonUnsent: async () => {
        throw new Error("db down");
      },
    });
    expect(await runScheduledSync(d.value)).toMatchObject({
      status: "ok",
      queued: 2,
      sent: 1,
      failed: 1,
      abandoned: 1,
    });
  });

  it("never has more than 8 jobs in flight (the default), or fewer when asked", async () => {
    quiet();
    for (const [concurrency, expected] of [
      [undefined, DEFAULT_CONCURRENCY],
      [3, 3],
    ] as const) {
      let inFlight = 0;
      let max = 0;
      const d = deps({
        rows: Array.from({ length: 30 }, (_, i) => queuedRun(i + 1)),
        concurrency,
        sender: () => async () => {
          inFlight += 1;
          max = Math.max(max, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 2));
          inFlight -= 1;
          return true;
        },
      });
      await runScheduledSync(d.value);
      expect(DEFAULT_CONCURRENCY).toBe(8);
      expect(max, String(concurrency)).toBeLessThanOrEqual(expected);
      expect(max, String(concurrency)).toBeGreaterThan(1);
    }
  });

  it("shuffles the queued runs before sending (the shuffle is applied to the queued runs only)", async () => {
    quiet();
    const order: string[] = [];
    let shuffleCalls = 0;
    const shuffle = <T>(items: T[]) => {
      shuffleCalls += 1;
      return [...items].reverse();
    };
    const d = deps({
      rows: [queuedRun(1), abandonedRun(9), queuedRun(2), queuedRun(3)],
      shuffle,
      concurrency: 1,
      sender: () => async (runId) => {
        order.push(runId);
        return true;
      },
    });
    await runScheduledSync(d.value);
    expect(order).toEqual([uuid(3), uuid(2), uuid(1)]);
    expect(shuffleCalls).toBe(1);
  });

  it("the default shuffle is a permutation: every run is still sent exactly once", async () => {
    quiet();
    const sent: string[] = [];
    const rows = Array.from({ length: 40 }, (_, i) => queuedRun(i + 1));
    const d = deps({
      rows,
      shuffle: undefined,
      sender: () => async (runId) => {
        sent.push(runId);
        return true;
      },
    });
    // `shuffle: undefined` in the spread keeps the default only if the property is absent.
    delete (d.value as { shuffle?: unknown }).shuffle;
    await runScheduledSync(d.value);
    expect([...sent].sort()).toEqual(rows.map((row) => row.runId).sort());
  });

  it("past the deadline the runs not yet sent are abandoned and audited (deadline) and not sent; the ones sent stay sent", async () => {
    quiet();
    let clock = 0;
    const sent: string[] = [];
    const d = deps({
      rows: Array.from({ length: 6 }, (_, i) => queuedRun(i + 1)),
      concurrency: 2,
      deadlineMs: 25_000,
      now: () => clock,
      sender: () => async (runId) => {
        sent.push(runId);
        clock += 7_000; // a batch of two takes 14 s: the second batch ends at 28 s, past the deadline
        return true;
      },
    });
    const result = await runScheduledSync(d.value);
    expect(DEFAULT_DEADLINE_MS).toBe(25_000);
    expect(sent).toEqual([uuid(1), uuid(2), uuid(3), uuid(4)]);
    expect(d.abandonUnsent.mock.calls).toEqual([
      [tenant, uuid(5), "deadline"],
      [tenant, uuid(6), "deadline"],
    ]);
    expect(result).toMatchObject({ queued: 6, sent: 4, failed: 0, unsent: 2 });
  });

  it("does nothing when nothing is due", async () => {
    quiet();
    const d = deps();
    expect(await runScheduledSync(d.value)).toEqual({
      status: "ok",
      queued: 0,
      sent: 0,
      failed: 0,
      abandoned: 0,
      unsent: 0,
    });
  });

  it("asks the database for sandbox connections only, until PI4 lifts the population-scope refusal", () => {
    expect(SCHEDULED_SANDBOX_ONLY).toBe(true);
  });

  it("refuses, before queueing anything, when the secret is missing or too short", async () => {
    quiet();
    for (const value of [undefined, "short"]) {
      const d = deps({ secret: undefined, rows: [queuedRun(1)] });
      delete (d.value as { secret?: unknown }).secret;
      const previous = process.env.INTEGRATION_JOB_SECRET;
      if (value === undefined) delete process.env.INTEGRATION_JOB_SECRET;
      else process.env.INTEGRATION_JOB_SECRET = value;
      try {
        expect(await runScheduledSync(d.value)).toMatchObject({ status: "refused", queued: 0, sent: 0 });
      } finally {
        if (previous === undefined) delete process.env.INTEGRATION_JOB_SECRET;
        else process.env.INTEGRATION_JOB_SECRET = previous;
      }
      expect(d.enqueue).not.toHaveBeenCalled();
    }
  });

  it("refuses, before queueing anything, when there is no worker to send to", async () => {
    quiet();
    const d = deps({ sender: () => null, rows: [queuedRun(1)] });
    expect((await runScheduledSync(d.value)).status).toBe("refused");
    expect(d.enqueue).not.toHaveBeenCalled();
  });
});
