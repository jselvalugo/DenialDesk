import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { integrationSyncRuns } from "@/db/schema";
import { verifyJob } from "@/integrations/jobs/signature";
import type { TransportResponse } from "@/integrations/fhir/transport";
import {
  activeSandbox,
  auditRows,
  connectionRow,
  harness,
  patientRows,
  type Ctx,
  type Harness,
} from "../support/sandbox-sync";
import { createTestTenant } from "./helpers";

// docs/specs/patient-integrations.md PI2b: the "Sync now" server action, against the real domain and
// database. Faked: the session, request headers (the language), Next's cache, and the transport wiring
// (the real in-process sandbox, as `connectionTestDeps` builds it).

type Role = "admin" | "manager" | "specialist" | "compliance";
let auth: {
  tenantId: string;
  userId: string;
  role: Role;
  mfaVerifiedAt?: Date | null;
  sessionId?: string;
};
let language = "en";
const wiring = vi.hoisted(() => ({ deps: undefined as unknown }));
const revalidated = vi.hoisted(() => ({ paths: [] as string[] }));

vi.mock("@/auth/session", () => ({ requireAuth: async () => auth }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () =>
    new Headers({
      "accept-language": language,
      "x-forwarded-for": "203.0.113.7",
      "user-agent": "Synthetic-Test-Browser/1.0",
    }),
}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidated.paths.push(path) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
vi.mock("@/app/(app)/settings/integrations/test-deps", () => ({ connectionTestDeps: () => wiring.deps }));

const { syncNowAction } = await import("@/app/(app)/settings/integrations/actions");

let ctx: Ctx;
let h: Harness;
let id: string;
beforeEach(async () => {
  language = "en";
  revalidated.paths.length = 0;
  ctx = await createTestTenant("Sync now action");
  h = harness();
  wiring.deps = h.deps;
  id = await activeSandbox(ctx, h);
  auth = { ...ctx, role: "admin", mfaVerifiedAt: new Date() };
});
afterAll(() => closeDatabase());

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const press = (fields: Record<string, string> = { id }) => syncNowAction({}, form(fields));
const status500 = (): TransportResponse => ({ status: 500, contentType: "text/html", body: "" });

describe("syncNowAction", () => {
  it("syncs for an administrator and answers with the counts in the reader's language", async () => {
    const state = await press();
    expect(state).toEqual({
      status: "succeeded",
      message:
        "123 new, 0 updated, 0 linked to existing patients, 2 skipped. Skipped records and their reasons are kept with the sync run.",
    });
    expect(await patientRows(ctx)).toHaveLength(123);
    // The drop-down in the signed-in layout shows the state and the last sync time.
    expect(revalidated.paths).toContain("/");
  });

  it("records who pressed the button on sync_started: admin IP, user agent, and session id (PR #98 review)", async () => {
    const sessionId = randomUUID();
    auth = { ...auth, sessionId };
    await press();
    const started = (await auditRows(ctx.tenantId)).find(
      (event) => event.action === "integration.sync_started",
    )!;
    expect(started.ipAddress).toBe("203.0.113.7");
    expect(started.userAgent).toBe("Synthetic-Test-Browser/1.0");
    expect(started.metadata).toMatchObject({
      trigger: "manual",
      triggered_by: ctx.userId,
      session_id: sessionId,
    });
    // The rest of the run's events stay the service principal's: no request facts of the administrator.
    const completed = (await auditRows(ctx.tenantId)).find(
      (event) => event.action === "integration.sync_completed",
    )!;
    expect(completed.ipAddress).toBeNull();
    expect(completed.userAgent).toBeNull();
  });

  it("answers in Spanish and Portuguese too", async () => {
    language = "es";
    const state = await press();
    expect(state.message).toMatch(/^123 nuevos, 0 actualizados/);
    const other = await createTestTenant("Sync now action pt");
    const otherHarness = harness();
    wiring.deps = otherHarness.deps;
    const otherId = await activeSandbox(other, otherHarness);
    auth = { ...other, role: "admin", mfaVerifiedAt: new Date() };
    language = "pt";
    expect((await press({ id: otherId })).message).toMatch(/^123 novos, 0 atualizados/);
  });

  it.each(["manager", "specialist", "compliance"] as const)(
    "refuses a %s, and dials nothing",
    async (role) => {
      auth = { ...auth, role };
      const before = h.transport.requests.length;
      expect(await press()).toEqual({ error: "Only an administrator can manage integrations." });
      expect(h.transport.requests.length).toBe(before);
      expect(await patientRows(ctx)).toEqual([]);
    },
  );

  it("refuses a malformed id and another practice's connection", async () => {
    expect(await press({ id: "not-a-uuid" })).toEqual({ error: "Integration not found." });
    const other = await createTestTenant("Sync now action stranger");
    auth = { ...other, role: "admin", mfaVerifiedAt: new Date() };
    expect(await press()).toEqual({ error: "Integration not found." });
    expect(await patientRows(ctx)).toEqual([]);
  });

  it("a run that fails is a result shown as text, in the reader's words, with nothing the remote sent", async () => {
    h.transport.intercept = async (init, next) =>
      new URL(init.url).pathname.endsWith("/Coverage/_search") ? status500() : next();
    const state = await press();
    expect(state).toEqual({
      status: "failed",
      message:
        "DenialDesk couldn't reach the EHR/PM, or it took too long. Nothing was lost. Try again in a few minutes.",
    });
    expect(JSON.stringify(state)).not.toMatch(/500|Coverage|sandbox/);
    expect((await connectionRow(id)).status).toBe("active");
  });

  it("a connection put in error by a refusal says so, and the run is on record", async () => {
    h.transport.intercept = async (init, next) =>
      init.method === "POST" && new URL(init.url).pathname.endsWith("/token")
        ? { status: 401, contentType: "application/json", body: "" }
        : next();
    const state = await press();
    expect(state.status).toBe("failed");
    expect(state.message).toMatch(/refused DenialDesk's credentials/);
    expect((await connectionRow(id)).status).toBe("error");
    const again = await press();
    // The next press is refused (once a minute), or, past the window, for not being active.
    expect(again.error).toBeDefined();
  });

  it("refuses a second press within the minute in words", async () => {
    // Pin the shared clock so the fixed window can't roll between the two presses.
    h.clock.current = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 10_000);
    expect((await press()).status).toBe("succeeded");
    expect(await press()).toEqual({ error: "Sync now can run once a minute. Wait a moment and try again." });
  });
});

describe("syncNowAction with a background worker configured (ADR 0012)", () => {
  const SECRET = "synthetic".repeat(5);
  const WORKER = "http://localhost:8888/.netlify/functions/integration-sync-background";
  const sent: { url: string; init: RequestInit }[] = [];

  beforeEach(() => {
    sent.length = 0;
    vi.stubEnv("INTEGRATION_JOB_SECRET", SECRET);
    vi.stubEnv("INTEGRATION_JOB_URL", WORKER);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        sent.push({ url, init });
        return new Response(null, { status: 202 });
      }),
    );
    // Pin the shared clock so the once-a-minute window can't roll mid-test.
    h.clock.current = new Date(Math.floor(Date.now() / 60_000) * 60_000 + 10_000);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("queues a signed `{ runId }` job and answers `queued` in the reader's language, without running the sync in the request", async () => {
    const state = await press();
    expect(state).toEqual({
      status: "queued",
      message:
        "The sync was queued and runs in the background. Its result appears in the sync history in a moment.",
    });
    expect(await patientRows(ctx)).toEqual([]);
    expect(h.transport.to("Patient")).toEqual([]);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(WORKER);
    const [run] = await systemDb()
      .select()
      .from(integrationSyncRuns)
      .where(eq(integrationSyncRuns.connectionId, id));
    expect(run).toMatchObject({ status: "queued", trigger: "manual", triggeredBy: ctx.userId });
    const headers = sent[0]!.init.headers as Record<string, string>;
    expect(sent[0]!.init.body).toBe(JSON.stringify({ runId: run!.id }));
    expect(
      verifyJob(Buffer.from(SECRET), sent[0]!.init.body as string, {
        get: (name) => headers[name.toLowerCase()] ?? null,
      }),
    ).toEqual({ ok: true, runId: run!.id });
    expect(revalidated.paths).toContain("/");

    const events = (await auditRows(ctx.tenantId)).filter(
      (event) => event.action === "integration.sync_queued",
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: ctx.userId,
      ipAddress: "203.0.113.7",
      userAgent: "Synthetic-Test-Browser/1.0",
    });
  });

  it("says so in Spanish and Portuguese", async () => {
    language = "es";
    expect((await press()).message).toMatch(/^La sincronización quedó en cola/);
    const other = await createTestTenant("Sync now action queued pt");
    const otherHarness = harness();
    otherHarness.clock.current = h.clock.current;
    wiring.deps = otherHarness.deps;
    const otherId = await activeSandbox(other, otherHarness);
    auth = { ...other, role: "admin", mfaVerifiedAt: new Date() };
    language = "pt";
    expect((await press({ id: otherId })).message).toMatch(/^A sincronização foi colocada na fila/);
  });

  it("refuses in words, and abandons the run, when the worker can't be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 502 })),
    );
    expect(await press()).toEqual({ error: "The sync couldn't be started. Try again in a moment." });
    const runs = await systemDb()
      .select()
      .from(integrationSyncRuns)
      .where(eq(integrationSyncRuns.connectionId, id));
    expect(runs.map((row) => row.status)).toEqual(["abandoned"]);
    expect(await patientRows(ctx)).toEqual([]);
  });

  it("refuses, and never runs quietly in the request, when the secret is set but too short", async () => {
    vi.stubEnv("INTEGRATION_JOB_SECRET", "short");
    expect(await press()).toEqual({ error: "The sync couldn't be started. Try again in a moment." });
    expect(sent).toEqual([]);
    expect(await patientRows(ctx)).toEqual([]);
  });

  it("with no secret it still runs in the request, as in local development", async () => {
    vi.stubEnv("INTEGRATION_JOB_SECRET", "");
    expect((await press()).status).toBe("succeeded");
    expect(sent).toEqual([]);
  });
});
