import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, integrationSyncRuns } from "@/db/schema";
import { INTEGRATION_SERVICE_PRINCIPAL_ID } from "@/domain/integrations/principal";
import { CONNECTION_ERROR_REASONS } from "@/domain/integrations/sync-codes";
import { executeSyncRun, type SyncRunResult } from "@/domain/integrations/sync";
import { insertQueuedRun } from "@/domain/integrations/sync-runs";
import { withTenant } from "@/db/tenant";
import { revokeConnection } from "@/domain/integrations/connections";
import type { TransportResponse } from "@/integrations/fhir/transport";
import {
  activeSandbox,
  adminActor,
  auditRows,
  connectionRow,
  harness,
  runRow,
  stampOf,
  type Ctx,
  type Harness,
} from "../support/sandbox-sync";
import { createTestTenant } from "./helpers";

// docs/specs/patient-integrations.md PI3: "Three consecutive failed runs -> `error`" (an audited,
// allow-listed code). Real PostgreSQL, synthetic sandbox only.

let ctx: Ctx;
beforeEach(async () => {
  ctx = await createTestTenant("Sync failures");
});
afterAll(() => closeDatabase());

const serverError: TransportResponse = { status: 500, contentType: "text/html", body: "" };
const path = (init: { url: URL }) => new URL(init.url).pathname;

function failing(h: Harness) {
  h.transport.intercept = async (init, next) => (path(init).endsWith("/Patient") ? serverError : next());
}
function healthy(h: Harness) {
  h.transport.intercept = undefined;
}

/** Queues and executes one run of the given trigger. */
async function run(
  c: Ctx,
  connectionId: string,
  h: Harness,
  trigger: "manual" | "scheduled" = "manual",
): Promise<{ runId: string; result: SyncRunResult }> {
  const runId = await withTenant(c, (tx) =>
    insertQueuedRun(tx, {
      tenantId: c.tenantId,
      connectionId,
      trigger,
      triggeredBy: trigger === "manual" ? c.userId : null,
    }),
  );
  return { runId, result: await executeSyncRun({ tenantId: c.tenantId, runId }, h.deps) };
}

async function erroredEvents(tenantId: string) {
  return (await auditRows(tenantId)).filter((event) => event.action === "integration.connection_errored");
}

describe("three consecutive failed runs move the connection to error", () => {
  it("the third failure in a row does, with an allow-listed code, and the connection change is audited as the service principal", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    failing(h);

    for (const n of [1, 2]) {
      const { result } = await run(ctx, id, h);
      expect(result, `run ${n}`).toMatchObject({ status: "failed", failure: "unreachable" });
      expect((await connectionRow(id)).status, `after run ${n}`).toBe("active");
    }
    const third = await run(ctx, id, h);
    expect(third.result).toMatchObject({ status: "failed", failure: "unreachable" });
    expect(await runRow(third.runId)).toMatchObject({ status: "failed" });

    const connection = await connectionRow(id);
    expect(connection.status).toBe("error");
    expect(connection.statusReason).toBe("repeated_failures");
    expect(CONNECTION_ERROR_REASONS).toContain(connection.statusReason);
    expect(connection.updatedBy).toBe(INTEGRATION_SERVICE_PRINCIPAL_ID);

    const events = await erroredEvents(ctx.tenantId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: INTEGRATION_SERVICE_PRINCIPAL_ID,
      entityType: "integration_connection",
      entityId: id,
      reason: "repeated_failures",
      metadata: expect.objectContaining({
        run_id: third.runId,
        reason_code: "repeated_failures",
        previous_status: "active",
        failed_runs: 3,
        last_failure_code: "unreachable",
      }),
    });
    // Nothing but codes, IDs and counts: no URL, no message.
    expect(JSON.stringify(events[0]!.metadata)).not.toMatch(/https?:|sandbox\.fhir/);

    // An errored connection takes no more runs from anyone: a queued run is abandoned by the database.
    await expect(
      withTenant(ctx, (tx) =>
        insertQueuedRun(tx, {
          tenantId: ctx.tenantId,
          connectionId: id,
          trigger: "scheduled",
          triggeredBy: null,
        }),
      ).then((runId) => executeSyncRun({ tenantId: ctx.tenantId, runId }, h.deps)),
    ).resolves.toMatchObject({ status: "abandoned" });
  });

  it("a success between failures ends the streak: two failures, a success, two failures leave it active", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    failing(h);
    await run(ctx, id, h);
    await run(ctx, id, h);
    healthy(h);
    expect((await run(ctx, id, h)).result.status).toBe("succeeded");
    failing(h);
    await run(ctx, id, h);
    await run(ctx, id, h);
    expect((await connectionRow(id)).status).toBe("active");
    expect(await erroredEvents(ctx.tenantId)).toEqual([]);
    // The next failure is the third since the success.
    await run(ctx, id, h);
    expect((await connectionRow(id)).status).toBe("error");
  });

  it("manual and scheduled runs count alike, and an abandoned run neither counts nor rescues", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    failing(h);
    await run(ctx, id, h, "manual");
    // A queued run that a lost job never started, abandoned by the lease: not a failure, not a success.
    const lost = await withTenant(ctx, (tx) =>
      insertQueuedRun(tx, {
        tenantId: ctx.tenantId,
        connectionId: id,
        trigger: "scheduled",
        triggeredBy: null,
      }),
    );
    await systemDb()
      .update(integrationSyncRuns)
      .set({ status: "abandoned", finishedAt: sql`now()` })
      .where(eq(integrationSyncRuns.id, lost));
    await run(ctx, id, h, "scheduled");
    expect((await connectionRow(id)).status).toBe("active");
    await run(ctx, id, h, "scheduled");
    expect((await connectionRow(id)).status).toBe("error");
    expect((await connectionRow(id)).statusReason).toBe("repeated_failures");
  });

  it("after the connection is resumed the count starts again: the old failures don't re-error it at the next one", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    failing(h);
    for (let n = 0; n < 3; n += 1) await run(ctx, id, h);
    expect((await connectionRow(id)).status).toBe("error");

    // Resume (its own rules, a passing Test connection and a step-up, are tested elsewhere): error -> active.
    await systemDb().execute(
      sql`update integration_connections set status = 'active', status_reason = null where id = ${id}::uuid`,
    );
    await run(ctx, id, h);
    await run(ctx, id, h);
    expect((await connectionRow(id)).status).toBe("active");
    await run(ctx, id, h);
    expect((await connectionRow(id)).status).toBe("error");
    expect(await erroredEvents(ctx.tenantId)).toHaveLength(2);
  });

  it("a failure that already errors the connection keeps its own reason (a refused credential is not 'repeated failures')", async () => {
    const h = harness();
    const id = await activeSandbox(ctx, h);
    h.transport.intercept = async (init, next) =>
      path(init).endsWith("/Patient") ? { status: 401, contentType: "text/html", body: "" } : next();
    const { result } = await run(ctx, id, h);
    expect(result).toMatchObject({ status: "failed", failure: "auth_refused", connectionErrored: true });
    expect(await connectionRow(id)).toMatchObject({ status: "error", statusReason: "auth_refused" });
    const [event] = await erroredEvents(ctx.tenantId);
    expect(event).toMatchObject({ reason: "auth_refused" });
    expect(event!.metadata).not.toHaveProperty("failed_runs");
  });

  it("another connection's failures are not counted", async () => {
    const h = harness();
    const first = await activeSandbox(ctx, h);
    const otherPractice = await createTestTenant("Sync failures other");
    const second = await activeSandbox(otherPractice, h);
    failing(h);
    await run(ctx, first, h);
    await run(otherPractice, second, h);
    await run(ctx, first, h);
    await run(otherPractice, second, h);
    expect((await connectionRow(first)).status).toBe("active");
    expect((await connectionRow(second)).status).toBe("active");
    expect(
      await systemDb()
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.tenantId, ctx.tenantId),
            eq(auditEvents.action, "integration.connection_errored"),
          ),
        ),
    ).toEqual([]);
  });

  it("another connection's failures in the SAME practice are not counted either (only one connection can be live, so the earlier one is revoked first)", async () => {
    const h = harness();
    const earlier = await activeSandbox(ctx, h);
    failing(h);
    await run(ctx, earlier, h);
    await run(ctx, earlier, h);
    expect((await connectionRow(earlier)).status).toBe("active");
    await withTenant(ctx, async (tx) =>
      revokeConnection(tx, adminActor(ctx), earlier, await stampOf(ctx, earlier), "no_longer_used"),
    );

    const later = await activeSandbox(ctx, h);
    // If the practice's failures were counted together, the first failure here would be the third.
    await run(ctx, later, h);
    await run(ctx, later, h);
    expect((await connectionRow(later)).status).toBe("active");
    expect(await erroredEvents(ctx.tenantId)).toEqual([]);
    await run(ctx, later, h);
    expect(await connectionRow(later)).toMatchObject({ status: "error", statusReason: "repeated_failures" });
    expect((await erroredEvents(ctx.tenantId)).map((event) => event.entityId)).toEqual([later]);
  });
});
