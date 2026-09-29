import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { integrationSyncRuns } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { IntegrationConnectionError, pauseConnection } from "@/domain/integrations/connections";
import { INTEGRATION_SERVICE_PRINCIPAL_ID } from "@/domain/integrations/principal";
import { requestSync, SCHEDULED_SANDBOX_ONLY } from "@/domain/integrations/sync";
import { enqueueDueRuns } from "@/domain/integrations/job-runs";
import { httpJobSender } from "@/integrations/jobs/dispatch";
import { runScheduledSync } from "@/integrations/jobs/scheduler";
import {
  JOB_SIGNATURE_HEADER,
  JOB_TIMESTAMP_HEADER,
  jobBodyFor,
  signJob,
} from "@/integrations/jobs/signature";
import { handleSyncJob, type JobResponse } from "@/integrations/jobs/worker";
import {
  activeRealConnection,
  activeSandbox,
  adminActor,
  auditRows,
  connectionRow,
  harness,
  patientRows,
  queueRun,
  runnerFor,
  runRow,
  stampOf,
  type Ctx,
  type Harness,
} from "../support/sandbox-sync";
import { createTestTenant } from "./helpers";

// docs/specs/patient-integrations.md PI2b "Jobs" and PI3, against a real PostgreSQL: a signed job runs a queued
// run of an active connection through the same engine as Sync now; every other call is refused and changes
// nothing. Synthetic sandbox only.

const secret = Buffer.from("synthetic".repeat(5), "utf8");
let ctx: Ctx;
let h: Harness;
beforeEach(async () => {
  ctx = await createTestTenant("Jobs worker");
  h = harness();
});
afterAll(() => closeDatabase());

const headersOf = (record: Record<string, string>) => ({
  get: (name: string) => record[name.toLowerCase()] ?? null,
});
const signedJob = (runId: string, at = new Date(), body = jobBodyFor(runId)) => ({
  body,
  headers: headersOf(signJob(secret, body, at)),
});
const worker = () => ({ sync: h.deps, secret: () => secret });
const post = (runId: string) => handleSyncJob(signedJob(runId), worker());

/** Everything a refusal must leave untouched: the run row, the connection row, the patients, the audit trail. */
async function snapshot(c: Ctx, runId: string, connectionId: string) {
  return {
    run: await runRow(runId),
    connection: await connectionRow(connectionId),
    patients: (await patientRows(c)).length,
    audit: (await auditRows(c.tenantId)).length,
    requests: h.transport.requests.length,
  };
}

const refused = (response: JobResponse) => response.status === 401 || response.status === 409;

describe("a signed job runs the run", () => {
  it("claims a queued run of an active connection and executes it with the same engine as Sync now", async () => {
    const id = await activeSandbox(ctx, h);
    const runId = await queueRun(ctx, id);
    const response = await post(runId);
    expect(response).toEqual({ status: 200, code: "done", runStatus: "succeeded" });
    expect(await runRow(runId)).toMatchObject({ status: "succeeded" });
    expect((await patientRows(ctx)).length).toBeGreaterThan(100);
    const started = (await auditRows(ctx.tenantId)).filter(
      (event) => event.action === "integration.sync_started",
    );
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ entityId: id, metadata: expect.objectContaining({ run_id: runId }) });
  });

  it("the tenant comes from the database, so a job cannot point a run at another practice", async () => {
    const other = await createTestTenant("Jobs worker other");
    const otherId = await activeSandbox(other, h);
    const otherRun = await queueRun(other, otherId);
    await post(otherRun);
    expect(await patientRows(ctx)).toEqual([]);
    expect((await patientRows(other)).length).toBeGreaterThan(100);
  });
});

describe("the worker refuses, and changes nothing", () => {
  it("an unsigned call", async () => {
    const id = await activeSandbox(ctx, h);
    const runId = await queueRun(ctx, id);
    const before = await snapshot(ctx, runId, id);
    const response = await handleSyncJob({ body: jobBodyFor(runId), headers: headersOf({}) }, worker());
    expect(response).toEqual({ status: 401, code: "unauthorized" });
    expect(await snapshot(ctx, runId, id)).toEqual(before);
    expect(before.run.status).toBe("queued");
  });

  it("a stale timestamp (one second outside the 5-minute window), and a future one", async () => {
    const id = await activeSandbox(ctx, h);
    const runId = await queueRun(ctx, id);
    const before = await snapshot(ctx, runId, id);
    for (const offsetSeconds of [-(5 * 60 + 1), 5 * 60 + 1]) {
      const response = await handleSyncJob(
        signedJob(runId, new Date(Date.now() + offsetSeconds * 1000)),
        worker(),
      );
      expect(response, String(offsetSeconds)).toEqual({ status: 401, code: "unauthorized" });
    }
    expect(await snapshot(ctx, runId, id)).toEqual(before);
  });

  it("a bad signature: another secret, a tampered signature, another run's signature", async () => {
    const id = await activeSandbox(ctx, h);
    const runId = await queueRun(ctx, id);
    const before = await snapshot(ctx, runId, id);
    const body = jobBodyFor(runId);
    const good = signJob(secret, body, new Date());
    const cases = [
      signJob(Buffer.from("different".repeat(5)), body, new Date()),
      { ...good, [JOB_SIGNATURE_HEADER]: `v1=${"ab".repeat(32)}` },
      // A valid signature, but for a different run's body.
      signJob(secret, jobBodyFor(randomUUID()), new Date()),
      { ...good, [JOB_TIMESTAMP_HEADER]: String(Number(good[JOB_TIMESTAMP_HEADER]) + 1) },
    ];
    for (const headers of cases) {
      expect(await handleSyncJob({ body, headers: headersOf(headers) }, worker())).toEqual({
        status: 401,
        code: "unauthorized",
      });
    }
    expect(await snapshot(ctx, runId, id)).toEqual(before);
  });

  it("a forged run ID: correctly signed, but no such run", async () => {
    const id = await activeSandbox(ctx, h);
    const runId = await queueRun(ctx, id);
    const before = await snapshot(ctx, runId, id);
    expect(await post(randomUUID())).toEqual({ status: 409, code: "not_claimable" });
    expect(await snapshot(ctx, runId, id)).toEqual(before);
  });

  it("an already-claimed run ID: once it has run, replaying the same signed job does nothing", async () => {
    const id = await activeSandbox(ctx, h);
    const runId = await queueRun(ctx, id);
    const job = signedJob(runId);
    expect((await handleSyncJob(job, worker())).status).toBe(200);
    const before = await snapshot(ctx, runId, id);
    // The very same request again, inside its 5-minute window.
    expect(await handleSyncJob(job, worker())).toEqual({ status: 409, code: "not_claimable" });
    expect(await snapshot(ctx, runId, id)).toEqual(before);
  });

  it("an already-claimed run ID: a run another worker has already started (running) is refused too", async () => {
    const id = await activeSandbox(ctx, h);
    const runId = await queueRun(ctx, id);
    await withTenant(ctx, (tx) =>
      tx.execute(
        sql`update integration_sync_runs set status = 'running', started_at = now(), heartbeat_at = now() where id = ${runId}::uuid`,
      ),
    );
    const before = await snapshot(ctx, runId, id);
    expect(await post(runId)).toEqual({ status: 409, code: "not_claimable" });
    expect(await snapshot(ctx, runId, id)).toEqual(before);
  });

  it("two workers holding the same job at once: exactly one runs it", async () => {
    const id = await activeSandbox(ctx, h);
    const runId = await queueRun(ctx, id);
    const results = await Promise.all([post(runId), post(runId), post(runId)]);
    expect(results.filter((response) => response.status === 200)).toHaveLength(1);
    expect(results.filter(refused)).toHaveLength(2);
    const started = (await auditRows(ctx.tenantId)).filter(
      (event) => event.action === "integration.sync_started",
    );
    expect(started).toHaveLength(1);
    expect(await runRow(runId)).toMatchObject({ status: "succeeded" });
  });

  it("a run for a connection that is not active: paused (its queued run is abandoned), and a queued run whose connection stopped being active without that", async () => {
    const id = await activeSandbox(ctx, h);
    const runId = await queueRun(ctx, id);
    await withTenant(ctx, async (tx) => pauseConnection(tx, adminActor(ctx), id, await stampOf(ctx, id)));
    const before = await snapshot(ctx, runId, id);
    expect(await post(runId)).toEqual({ status: 409, code: "not_claimable" });
    expect(await snapshot(ctx, runId, id)).toEqual(before);
    expect(before.run.status).toBe("abandoned");

    // Errored and revoked connections likewise.
    for (const status of ["error", "revoked"] as const) {
      const c = await createTestTenant("Jobs worker inactive");
      const cid = await activeSandbox(c, h);
      const rid = await queueRun(c, cid);
      await systemDb().transaction(async (tx) => {
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx.execute(
          sql`update integration_connections set status = ${status}::integration_connection_status,
                status_reason = ${status === "error" ? "auth_refused" : "no_longer_used"},
                revoked_by = ${status === "revoked" ? c.userId : null}::uuid,
                revoked_at = ${status === "revoked" ? new Date().toISOString() : null}::timestamptz
              where id = ${cid}::uuid`,
        );
      });
      const beforeThis = await snapshot(c, rid, cid);
      expect((await post(rid)).status, status).toBe(409);
      expect(await snapshot(c, rid, cid), status).toEqual(beforeThis);
    }
  });

  it("everything, while the secret is missing or too short: 503 and the run stays queued", async () => {
    const id = await activeSandbox(ctx, h);
    const runId = await queueRun(ctx, id);
    const before = await snapshot(ctx, runId, id);
    for (const env of [undefined, "short"]) {
      const previous = process.env.INTEGRATION_JOB_SECRET;
      if (env === undefined) delete process.env.INTEGRATION_JOB_SECRET;
      else process.env.INTEGRATION_JOB_SECRET = env;
      try {
        // No `secret` override: the environment decides, as it does in the function.
        const response = await handleSyncJob(signedJob(runId), { sync: h.deps });
        expect(response).toEqual({ status: 503, code: "unavailable" });
      } finally {
        if (previous === undefined) delete process.env.INTEGRATION_JOB_SECRET;
        else process.env.INTEGRATION_JOB_SECRET = previous;
      }
    }
    expect(await snapshot(ctx, runId, id)).toEqual(before);
  });
});

describe("the environment guard still refuses a real connection (fail closed)", () => {
  it("a signed job for a queued run of an active real-style connection is claimed, then refused by the engine before any transport is asked for", async () => {
    const id = await activeRealConnection(ctx);
    const runId = await queueRun(ctx, id);
    const response = await post(runId);
    expect(response).toEqual({ status: 200, code: "done", runStatus: "failed" });
    expect(await runRow(runId)).toMatchObject({ status: "failed", issueCodes: ["environment_refused"] });
    expect(h.transport.requests).toEqual([]);
    expect(await patientRows(ctx)).toEqual([]);
  });
});

describe("Sync now hands the run to the worker (requestSync)", () => {
  /** Ten seconds into a minute, so the once-a-minute window can't roll mid-test. */
  const pinClock = () => {
    h.clock.current = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 10_000);
  };
  const sending = (send: (runId: string) => Promise<boolean>) => ({ kind: "send", send }) as const;
  const eventsOf = async (action: string) =>
    (await auditRows(ctx.tenantId)).filter((event) => event.action === action);

  it("with a sender: returns `queued` at once, leaves the run queued for the worker, and audits who pressed it", async () => {
    pinClock();
    const id = await activeSandbox(ctx, h);
    const sent: string[] = [];
    const result = await requestSync(runnerFor(ctx), adminActor(ctx), id, {
      ...h.deps,
      jobs: sending(async (runId) => {
        sent.push(runId);
        return true;
      }),
    });
    expect(result).toMatchObject({ status: "queued" });
    const runId = (result as { runId: string }).runId;
    expect(sent).toEqual([runId]);
    expect(await runRow(runId)).toMatchObject({
      status: "queued",
      trigger: "manual",
      triggeredBy: ctx.userId,
    });
    expect(h.transport.to("Patient")).toEqual([]);
    const events = await eventsOf("integration.sync_queued");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: ctx.userId,
      entityId: id,
      reason: "sync_now",
      metadata: expect.objectContaining({ run_id: runId }),
    });

    // A second press while it is queued is refused, and the worker then runs the one queued run.
    h.clock.current = new Date(h.clock.current.getTime() + 61_000);
    await expect(
      requestSync(runnerFor(ctx), adminActor(ctx), id, { ...h.deps, jobs: sending(async () => true) }),
    ).rejects.toThrow("A sync is already running for this connection.");
    expect(await post(runId)).toEqual({ status: 200, code: "done", runStatus: "succeeded" });
  });

  it("the queued audit is committed with the run row, before the job is sent (review O2)", async () => {
    pinClock();
    const id = await activeSandbox(ctx, h);
    let seenAtSend: { runs: number; queuedEvents: number } | undefined;
    await requestSync(runnerFor(ctx), adminActor(ctx), id, {
      ...h.deps,
      jobs: sending(async (runId) => {
        seenAtSend = {
          runs: (await systemDb().select().from(integrationSyncRuns).where(eq(integrationSyncRuns.id, runId)))
            .length,
          queuedEvents: (await eventsOf("integration.sync_queued")).length,
        };
        return true;
      }),
    });
    expect(seenAtSend).toEqual({ runs: 1, queuedEvents: 1 });
  });

  it("if the worker can't be reached, the run is abandoned at once and audited, and the press is refused (so it can be pressed again)", async () => {
    pinClock();
    const id = await activeSandbox(ctx, h);
    for (const send of [
      async () => false,
      async () => {
        throw new Error("network down");
      },
    ]) {
      await expect(
        requestSync(runnerFor(ctx), adminActor(ctx), id, { ...h.deps, jobs: sending(send) }),
      ).rejects.toThrow(IntegrationConnectionError);
      const runs = await systemDb()
        .select()
        .from(integrationSyncRuns)
        .where(eq(integrationSyncRuns.connectionId, id));
      expect(runs.every((row) => row.status === "abandoned")).toBe(true);
      // Move past the once-a-minute window: the connection is free again.
      h.clock.current = new Date(h.clock.current.getTime() + 61_000);
    }
    const failed = (await eventsOf("integration.sync_failed")).filter((event) => event.reason === "sync_now");
    expect(failed).toHaveLength(2);
    expect(failed[0]!.metadata).toMatchObject({ code: "job_not_sent" });
  });

  it("a post that timed out after the worker had already claimed the run is still queued, not abandoned or refused (review O2)", async () => {
    pinClock();
    const id = await activeSandbox(ctx, h);
    let claimedRun = "";
    const result = await requestSync(runnerFor(ctx), adminActor(ctx), id, {
      ...h.deps,
      jobs: sending(async (runId) => {
        // The worker got the job and started the run; only the response was lost.
        claimedRun = runId;
        await systemDb().transaction(async (tx) => {
          await tx.execute(
            sql`update integration_sync_runs set status = 'running', started_at = now(), heartbeat_at = now() where id = ${runId}::uuid`,
          );
        });
        throw new Error("timed out waiting for the response");
      }),
    });
    expect(result).toEqual({ runId: claimedRun, status: "queued" });
    expect(await runRow(claimedRun)).toMatchObject({ status: "running" });
    expect(await eventsOf("integration.sync_failed")).toEqual([]);
    expect(await eventsOf("integration.sync_queued")).toHaveLength(1);
  });

  it("a secret that is too short refuses BEFORE anything is queued: no run row, no audit, and the once-a-minute allowance is not used (review O3)", async () => {
    pinClock();
    const id = await activeSandbox(ctx, h);
    await expect(
      requestSync(runnerFor(ctx), adminActor(ctx), id, { ...h.deps, jobs: { kind: "refused" } }),
    ).rejects.toThrow("The sync couldn't be started. Try again in a moment.");
    expect(
      await systemDb().select().from(integrationSyncRuns).where(eq(integrationSyncRuns.connectionId, id)),
    ).toEqual([]);
    expect(await eventsOf("integration.sync_queued")).toEqual([]);
    // Same minute, same connection: the press that follows is not rate limited by the refused one.
    const result = await requestSync(runnerFor(ctx), adminActor(ctx), id, {
      ...h.deps,
      jobs: sending(async () => true),
    });
    expect(result).toMatchObject({ status: "queued" });
  });

  it("a refused press still answers 'only an administrator' to someone who isn't one", async () => {
    pinClock();
    const id = await activeSandbox(ctx, h);
    await expect(
      requestSync(runnerFor(ctx), { ...adminActor(ctx), role: "specialist" }, id, {
        ...h.deps,
        jobs: { kind: "refused" },
      }),
    ).rejects.toThrow("Only an administrator can manage integrations.");
  });

  it("without `jobs` the run executes in the request, as before (tests, local development)", async () => {
    pinClock();
    const id = await activeSandbox(ctx, h);
    const result = await requestSync(runnerFor(ctx), adminActor(ctx), id, h.deps);
    expect(result).toMatchObject({ status: "succeeded" });
    expect((await patientRows(ctx)).length).toBeGreaterThan(100);
    expect(await eventsOf("integration.sync_queued")).toEqual([]);
  });

  it("every refusal of Sync now still comes first, before a job is sent: not an admin, real connection", async () => {
    pinClock();
    const id = await activeSandbox(ctx, h);
    const sent: string[] = [];
    const deps = {
      ...h.deps,
      jobs: sending(async (runId: string) => {
        sent.push(runId);
        return true;
      }),
    };
    await expect(
      requestSync(runnerFor(ctx), { ...adminActor(ctx), role: "specialist" }, id, deps),
    ).rejects.toThrow("Only an administrator can manage integrations.");
    // A practice may have one live connection, so the real-style one is another practice's.
    const otherPractice = await createTestTenant("Jobs worker real");
    const real = await activeRealConnection(otherPractice);
    await expect(
      requestSync(runnerFor(otherPractice), adminActor(otherPractice, { synthetic: false }), real, deps),
    ).rejects.toThrow("can't sync yet");
    expect(sent).toEqual([]);
  });
});

describe("the scheduled tick end to end", () => {
  /** The real database calls, narrowed to this test's practice (a shared test database holds other tests' leftover connections, whose runs are left alone). */
  const ownTick = () => async () =>
    (await enqueueDueRuns(true)).filter((row) => row.tenantId === ctx.tenantId);

  /** The real sender, pointed at an in-process "worker" through a fetch stand-in: the signed request travels exactly as over HTTP. */
  function inProcessWorker(
    key: Buffer,
    results: JobResponse[],
    respond: (status: number) => number = (n) => n,
  ) {
    const fetchToWorker = (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      const response = await handleSyncJob(
        { body: init.body as string, headers: headersOf(headers) },
        { sync: h.deps, secret: () => key },
      );
      results.push(response);
      return new Response(null, { status: respond(response.status === 200 ? 202 : response.status) });
    }) as unknown as typeof fetch;
    return httpJobSender({ url: "https://worker.example.test/w", secret: key, fetch: fetchToWorker });
  }

  const eventsOf = async (action: string) =>
    (await auditRows(ctx.tenantId)).filter((event) => event.action === action);

  it("queues the due connection and posts a signed job that the worker accepts and runs", async () => {
    const id = await activeSandbox(ctx, h);
    const results: JobResponse[] = [];
    const result = await runScheduledSync({
      secret: () => secret,
      enqueue: ownTick(),
      sender: (key) => inProcessWorker(key, results),
    });
    expect(result).toEqual({ status: "ok", queued: 1, sent: 1, failed: 0, abandoned: 0, unsent: 0 });
    expect(results).toEqual([{ status: 200, code: "done", runStatus: "succeeded" }]);
    const [run] = await systemDb()
      .select()
      .from(integrationSyncRuns)
      .where(eq(integrationSyncRuns.tenantId, ctx.tenantId));
    expect(run).toMatchObject({
      connectionId: id,
      status: "succeeded",
      trigger: "scheduled",
      triggeredBy: null,
    });
    expect((await patientRows(ctx)).length).toBeGreaterThan(100);
    const started = await eventsOf("integration.sync_started");
    expect(started[0]!.metadata).toMatchObject({ trigger: "scheduled", triggered_by: null });
  });

  it("the very next tick finds nothing due (the run is fresh)", async () => {
    await activeSandbox(ctx, h);
    const first = await ownTick()();
    const second = await ownTick()();
    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it("audits a run the database abandoned for going quiet past the lease (lease_expired) as the service principal, and runs a fresh one", async () => {
    const id = await activeSandbox(ctx, h);
    const [stale] = await systemDb()
      .insert(integrationSyncRuns)
      .values({
        tenantId: ctx.tenantId,
        connectionId: id,
        trigger: "scheduled",
        queuedAt: new Date(Date.now() - 25 * 60_000),
      })
      .returning({ id: integrationSyncRuns.id });
    const results: JobResponse[] = [];
    const result = await runScheduledSync({
      secret: () => secret,
      enqueue: ownTick(),
      sender: (key) => inProcessWorker(key, results),
    });
    expect(result).toMatchObject({ status: "ok", queued: 1, sent: 1, abandoned: 1 });
    expect(await runRow(stale!.id)).toMatchObject({ status: "abandoned" });
    const events = await eventsOf("integration.sync_abandoned");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: INTEGRATION_SERVICE_PRINCIPAL_ID,
      entityId: id,
      reason: "lease_expired",
      metadata: expect.objectContaining({ run_id: stale!.id, reason_code: "lease_expired" }),
    });
    expect(results).toEqual([{ status: 200, code: "done", runStatus: "succeeded" }]);
  });

  it("a job that can't be posted abandons its run and audits it (job_not_sent), and the very next tick queues the connection again", async () => {
    const id = await activeSandbox(ctx, h);
    const first = await runScheduledSync({
      secret: () => secret,
      enqueue: ownTick(),
      sender: () => async () => false,
    });
    expect(first).toMatchObject({ status: "ok", queued: 1, sent: 0, failed: 1 });
    const [run] = await systemDb()
      .select()
      .from(integrationSyncRuns)
      .where(eq(integrationSyncRuns.connectionId, id));
    expect(run).toMatchObject({ status: "abandoned", startedAt: null });
    const events = await eventsOf("integration.sync_abandoned");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: INTEGRATION_SERVICE_PRINCIPAL_ID,
      reason: "job_not_sent",
      metadata: expect.objectContaining({ run_id: run!.id }),
    });
    // Not blocked for 14 or 20 minutes: a run that never started isn't "recent".
    const second = await ownTick()();
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ outcome: "queued" });
  });

  it("a run the worker claimed although its post looked failed is not abandoned or audited", async () => {
    const id = await activeSandbox(ctx, h);
    const results: JobResponse[] = [];
    // The worker runs the job, but the scheduler sees a 502 (the response was lost).
    const result = await runScheduledSync({
      secret: () => secret,
      enqueue: ownTick(),
      sender: (key) => inProcessWorker(key, results, () => 502),
    });
    expect(result).toMatchObject({ queued: 1, sent: 0, failed: 1 });
    const [run] = await systemDb()
      .select()
      .from(integrationSyncRuns)
      .where(eq(integrationSyncRuns.connectionId, id));
    expect(run).toMatchObject({ status: "succeeded" });
    expect(await eventsOf("integration.sync_abandoned")).toEqual([]);
  });

  it("only sandbox connections are queued: a real active connection is skipped, so it can't walk into a misleading error", async () => {
    const real = await createTestTenant("Jobs worker scheduler real");
    await activeRealConnection(real);
    const rows = (await enqueueDueRuns(SCHEDULED_SANDBOX_ONLY)).filter(
      (row) => row.tenantId === real.tenantId,
    );
    expect(rows).toEqual([]);
  });
});
