import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase } from "@/db/client";
import type { TransportResponse } from "@/integrations/fhir/transport";
import {
  activeSandbox,
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
let auth: { tenantId: string; userId: string; role: Role; mfaVerifiedAt?: Date | null };
let language = "en";
const wiring = vi.hoisted(() => ({ deps: undefined as unknown }));
const revalidated = vi.hoisted(() => ({ paths: [] as string[] }));

vi.mock("@/auth/session", () => ({ requireAuth: async () => auth }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "accept-language": language }),
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
