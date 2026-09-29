import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { integrationSyncRuns } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  createConnection,
  IntegrationConnectionError,
  pauseConnection,
  revokeConnection,
} from "@/domain/integrations/connections";
import { syncNow, syncResultMessage } from "@/domain/integrations/sync";
import {
  abandonStaleRuns,
  insertQueuedRun,
  isRunAlreadyActive,
  RUN_LEASE_MS,
} from "@/domain/integrations/sync-runs";
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

// docs/specs/patient-integrations.md PI2b: the "Sync now" service: admin only, the environment rule, an
// active connection, once a minute, one run at a time with a 20-minute lease. Synthetic sandbox only.

let ctx: Ctx;
beforeEach(async () => {
  ctx = await createTestTenant("Sync now");
});
afterAll(() => closeDatabase());

async function refusal(promise: Promise<unknown>): Promise<IntegrationConnectionError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IntegrationConnectionError) return error;
    throw error;
  }
  throw new Error("Expected an IntegrationConnectionError, but the call succeeded");
}

/** The engine's and the rate limiter's clock, pinned ten seconds into a minute so a window can't roll mid-test. */
function pinClock(h: Harness) {
  h.clock.current = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 10_000);
}

const sync = (c: Ctx, id: string, h: Harness, actor = adminActor(c)) =>
  syncNow(runnerFor(c), actor, id, h.deps);

describe("syncNow — refusals before anything is queued", () => {
  it("only an administrator", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    for (const role of ["manager", "specialist", "compliance"] as const) {
      const error = await refusal(sync(ctx, id, h, { ...adminActor(ctx), role }));
      expect(error.message).toBe("Only an administrator can manage integrations.");
    }
    expect(
      await systemDb().select().from(integrationSyncRuns).where(eq(integrationSyncRuns.connectionId, id)),
    ).toEqual([]);
  });

  it("another practice's connection is not found, and nothing is queued for it", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const other = await createTestTenant("Sync now other");
    expect((await refusal(sync(other, id, h))).message).toBe("Integration not found.");
    expect(
      await systemDb().select().from(integrationSyncRuns).where(eq(integrationSyncRuns.connectionId, id)),
    ).toEqual([]);
  });

  it("only an active connection: a draft, a paused, and a connection in error are refused; a revoked one says so", async () => {
    const h = harness();
    const { id: draft } = await withTenant(ctx, (tx) =>
      createConnection(tx, adminActor(ctx, { synthetic: false }), {
        displayName: "A draft",
        baseUrl: "https://fhir.example.com/r4",
        clientId: "client-draft",
        mrnIdentifierSystem: "https://fhir.example.com/mrn",
      }),
    );
    // A real draft in a real-data environment is refused for not being active.
    expect((await refusal(sync(ctx, draft, h, adminActor(ctx, { synthetic: false })))).message).toBe(
      "Only an active connection can sync. Resume it first.",
    );

    const other = await createTestTenant("Sync now paused");
    const id = await activeSandbox(other, h);
    await withTenant(other, async (tx) =>
      pauseConnection(tx, adminActor(other), id, await stampOf(other, id)),
    );
    expect((await refusal(sync(other, id, h))).message).toBe(
      "Only an active connection can sync. Resume it first.",
    );
    await withTenant(other, (tx) =>
      tx.execute(sql`update integration_connections set status = 'active' where id = ${id}::uuid`),
    );
    await withTenant(other, (tx) =>
      tx.execute(
        sql`update integration_connections set status = 'error', status_reason = 'auth_refused' where id = ${id}::uuid`,
      ),
    );
    expect((await refusal(sync(other, id, h))).message).toBe(
      "Only an active connection can sync. Resume it first.",
    );
    await withTenant(other, async (tx) =>
      revokeConnection(tx, adminActor(other), id, await stampOf(other, id), "no_longer_used"),
    );
    expect((await refusal(sync(other, id, h))).message).toBe(
      "This connection is revoked and can no longer change.",
    );
    expect(await patientRows(other)).toEqual([]);
  });

  it("the environment rule: a real endpoint where only synthetic data is allowed, and the sandbox where it isn't", async () => {
    const h = harness();
    const { id: real } = await withTenant(ctx, (tx) =>
      createConnection(tx, adminActor(ctx, { synthetic: false }), {
        displayName: "A real one",
        baseUrl: "https://fhir.example.com/r4",
        clientId: "client-real",
        mrnIdentifierSystem: "https://fhir.example.com/mrn",
      }),
    );
    // APP_ENV=production on Netlify is still synthetic-only: the actor's flag is `syntheticDataOnly()`.
    expect((await refusal(sync(ctx, real, h, adminActor(ctx, { synthetic: true })))).message).toMatch(
      /can't connect to a real EHR\/PM/,
    );

    const other = await createTestTenant("Sync now production");
    const sandbox = await activeSandbox(other, h);
    expect((await refusal(sync(other, sandbox, h, adminActor(other, { synthetic: false })))).message).toBe(
      "The built-in test sandbox isn't available in production.",
    );
    expect(h.transport.to("Patient")).toEqual([]);
  });

  it("an active real connection is refused, audited, and nothing is queued or dialed, until PI4 applies the population scope", async () => {
    const h = harness();
    const id = await activeRealConnection(ctx);
    const error = await refusal(sync(ctx, id, h, adminActor(ctx, { synthetic: false })));
    expect(error.message).toBe(
      "Real EHR/PM connections can't sync yet: DenialDesk can't yet limit them to your practice's own patients. Nothing was requested.",
    );
    expect(
      await systemDb().select().from(integrationSyncRuns).where(eq(integrationSyncRuns.connectionId, id)),
    ).toEqual([]);
    expect(h.transport.requests).toEqual([]);
    expect(await patientRows(ctx)).toEqual([]);
    const refused = (await auditRows(ctx.tenantId)).filter(
      (event) => event.action === "integration.sync_failed",
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ entityId: id, actorUserId: ctx.userId, reason: "sync_now" });
    expect(refused[0]!.metadata).toMatchObject({ code: "population_scope_unenforced" });
  });
});

describe("syncNow — a run", () => {
  it("a Pause between queueing the run and starting it is an abandoned result, not an error page (PR #98 review)", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const base = runnerFor(ctx);
    let paused = false;
    // Pause the connection right after the run row is inserted, before the engine claims it.
    const runner: typeof base = async (fn) => {
      const value = await base(fn);
      if (!paused && typeof value === "string" && /^[0-9a-f-]{36}$/.test(value)) {
        paused = true;
        await withTenant(ctx, async (tx) => pauseConnection(tx, adminActor(ctx), id, await stampOf(ctx, id)));
      }
      return value;
    };
    const result = await syncNow(runner, adminActor(ctx), id, h.deps);
    expect(paused).toBe(true);
    expect(result).toMatchObject({ status: "abandoned", created: 0, updated: 0, linked: 0, skipped: 0 });
    expect((await runRow(result.runId)).status).toBe("abandoned");
    expect(h.transport.to("Patient")).toEqual([]);
    expect(await patientRows(ctx)).toEqual([]);
    expect(syncResultMessage(result)).toBe(
      "The sync stopped because the connection was paused, revoked, or put in error while it ran. Patients already saved were kept.",
    );
  });

  it("queues a manual run for the administrator, executes it, and records who pressed the button", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const result = await sync(ctx, id, h);
    expect(result).toMatchObject({ status: "succeeded", created: 123, skipped: 2 });
    const run = await runRow(result.runId);
    expect(run).toMatchObject({
      trigger: "manual",
      triggeredBy: ctx.userId,
      status: "succeeded",
      connectionId: id,
    });
    const events = await auditRows(ctx.tenantId);
    const started = events.find((event) => event.action === "integration.sync_started")!;
    expect(started.metadata).toMatchObject({ trigger: "manual", triggered_by: ctx.userId });
    // The audit actor is the service principal, never the administrator; the administrator is metadata.
    expect(started.actorUserId).not.toBe(ctx.userId);
    expect((await connectionRow(id)).lastSuccessAt).not.toBeNull();
  });

  it("is limited to once a minute per connection, audited, and queues nothing for the refused press", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    pinClock(h);
    await sync(ctx, id, h);
    const error = await refusal(sync(ctx, id, h));
    expect(error.message).toBe("Sync now can run once a minute. Wait a moment and try again.");
    const runs = await systemDb()
      .select()
      .from(integrationSyncRuns)
      .where(eq(integrationSyncRuns.connectionId, id));
    expect(runs).toHaveLength(1);
    const limited = (await auditRows(ctx.tenantId)).filter(
      (event) => event.action === "security.rate_limited",
    );
    expect(limited).toHaveLength(1);
    expect(limited[0]).toMatchObject({ entityId: id, actorUserId: ctx.userId, reason: "sync_now" });
    expect(limited[0]!.metadata).toEqual({ bucket: "integration_sync_now" });
    // A minute later it is allowed again.
    h.clock.current = new Date(h.clock.current.getTime() + 60_000);
    expect((await sync(ctx, id, h)).status).toBe("succeeded");
  });

  it("the limit is per connection: another practice's press is not counted", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const other = await createTestTenant("Sync now neighbour");
    const otherId = await activeSandbox(other, h);
    pinClock(h);
    await sync(ctx, id, h);
    expect((await sync(other, otherId, h)).status).toBe("succeeded");
  });

  it("one run at a time: a queued or freshly running run refuses another press", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const queued = await queueRun(ctx, id);
    expect((await refusal(sync(ctx, id, h))).message).toBe("A sync is already running for this connection.");
    expect((await runRow(queued)).status).toBe("queued");

    // Running, with a heartbeat a minute ago: still alive.
    await systemDb().execute(
      sql`update integration_sync_runs set status = 'running', started_at = now() - interval '2 minutes', heartbeat_at = now() - interval '1 minute' where id = ${queued}::uuid`,
    );
    h.clock.current = new Date(h.clock.current.getTime() + 60_000);
    expect((await refusal(sync(ctx, id, h))).message).toBe("A sync is already running for this connection.");
    expect((await runRow(queued)).status).toBe("running");
  });

  it("abandons a run that has gone quiet for the 20-minute lease, then syncs", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const dead = await queueRun(ctx, id);
    await systemDb().execute(
      sql`update integration_sync_runs set status = 'running', started_at = now() - interval '40 minutes', heartbeat_at = now() - interval '21 minutes' where id = ${dead}::uuid`,
    );
    const result = await sync(ctx, id, h);
    expect(result.status).toBe("succeeded");
    expect(await runRow(dead)).toMatchObject({ status: "abandoned" });
    expect((await runRow(dead)).finishedAt).not.toBeNull();
    expect(RUN_LEASE_MS).toBe(20 * 60 * 1000);
  });

  it("the lease is measured from the last heartbeat, at its boundary; a queued run nobody picked up expires too", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    const running = await queueRun(ctx, id);
    await systemDb().execute(
      sql`update integration_sync_runs set status = 'running', started_at = now() - interval '90 minutes', heartbeat_at = now() - interval '19 minutes 30 seconds' where id = ${running}::uuid`,
    );
    expect(await withTenant(ctx, (tx) => abandonStaleRuns(tx, ctx.tenantId, id))).toBe(0);
    await systemDb().execute(
      sql`update integration_sync_runs set heartbeat_at = now() - interval '20 minutes 30 seconds' where id = ${running}::uuid`,
    );
    expect(await withTenant(ctx, (tx) => abandonStaleRuns(tx, ctx.tenantId, id))).toBe(1);
    expect((await runRow(running)).status).toBe("abandoned");

    const queued = await queueRun(ctx, id);
    await systemDb().execute(
      sql`update integration_sync_runs set queued_at = now() - interval '19 minutes' where id = ${queued}::uuid`,
    );
    expect(await withTenant(ctx, (tx) => abandonStaleRuns(tx, ctx.tenantId, id))).toBe(0);
    await systemDb().execute(
      sql`update integration_sync_runs set queued_at = now() - interval '21 minutes' where id = ${queued}::uuid`,
    );
    expect(await withTenant(ctx, (tx) => abandonStaleRuns(tx, ctx.tenantId, id))).toBe(1);
    expect((await runRow(queued)).status).toBe("abandoned");
  });

  it("only one queued or running run per connection can exist: a second insert is the unique violation the service maps to `already running`", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    await queueRun(ctx, id);
    let caught: unknown;
    try {
      await withTenant(ctx, (tx) =>
        insertQueuedRun(tx, {
          tenantId: ctx.tenantId,
          connectionId: id,
          trigger: "manual",
          triggeredBy: ctx.userId,
        }),
      );
    } catch (error) {
      caught = error;
    }
    expect(isRunAlreadyActive(caught)).toBe(true);
    expect(h.transport.to("Patient")).toEqual([]);
  });
});
