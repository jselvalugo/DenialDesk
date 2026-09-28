import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { integrationConnections } from "@/db/schema";
import { createTestTenant } from "./helpers";

// docs/specs/patient-integrations.md PI1b-2: the Settings › Integrations server actions, run against
// the real domain and database. Only the session, request headers, and Next's redirect are faked.
// Covers what the pages can't show in e2e (the e2e users aren't administrators): every action
// re-checks the role, extra form fields are ignored, revoke needs the confirmation, and the
// environment rule comes from the server.

type Role = "admin" | "manager" | "specialist" | "compliance";
let auth: { tenantId: string; userId: string; role: Role };

vi.mock("@/auth/session", () => ({ requireAuth: async () => auth }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "accept-language": "en" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));

const { createConnectionAction, revokeConnectionAction, updateConnectionAction } =
  await import("@/app/(app)/settings/integrations/actions");

let practice: { tenantId: string; userId: string };
const savedEnv = { ...process.env };

beforeAll(async () => {
  practice = await createTestTenant("Connection actions");
});
afterEach(() => {
  process.env = { ...savedEnv };
});
afterAll(() => closeDatabase());

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** Runs an action; a redirect (success) comes back as `{ redirectedTo }`. */
async function run<T>(action: (state: object, data: FormData) => Promise<T>, data: FormData) {
  try {
    return { state: await action({}, data) };
  } catch (error) {
    if (error instanceof Redirect) return { redirectedTo: error.to };
    throw error;
  }
}

async function row(id: string) {
  const [stored] = await systemDb()
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id));
  return stored!;
}

function productionOffNetlify() {
  process.env.APP_ENV = "production";
  for (const key of ["NETLIFY", "NETLIFY_DB_URL", "DEPLOY_ID", "SITE_ID"]) delete process.env[key];
}

describe("Settings › Integrations actions (PI1b-2)", () => {
  it("refuses every action for a role other than administrator, writing nothing", async () => {
    auth = { ...practice, role: "admin" };
    const created = await run(createConnectionAction, form({ displayName: "Sandbox for role test" }));
    const id = created.redirectedTo!.split("/").pop()!;
    const before = await row(id);
    for (const role of ["manager", "specialist", "compliance"] as const) {
      auth = { ...practice, role };
      const stamp = before.updatedAt.toISOString();
      for (const [action, data] of [
        [createConnectionAction, form({ displayName: "Not allowed" })],
        [updateConnectionAction, form({ id, updatedAt: stamp, displayName: "Not allowed" })],
        [revokeConnectionAction, form({ id, updatedAt: stamp, confirm: "on" })],
      ] as const) {
        const result = await run(action, data);
        expect(result.state?.error).toMatch(/Only an administrator/);
      }
    }
    expect(await row(id)).toMatchObject({ displayName: "Sandbox for role test", status: "draft" });
  });

  it("creates the built-in sandbox where only synthetic data is allowed, ignoring any other field", async () => {
    auth = { ...practice, role: "admin" };
    const result = await run(
      createConnectionAction,
      form({
        displayName: "Sandbox via form",
        baseUrl: "https://real-ehr.example.com/r4",
        clientId: "real-client",
        status: "active",
        tenantId: randomUUID(),
      }),
    );
    const id = result.redirectedTo!.replace("/settings/integrations/", "");
    expect(await row(id)).toMatchObject({
      tenantId: practice.tenantId,
      isSandbox: true,
      status: "draft",
      baseUrl: "https://sandbox.fhir.denialdesk.invalid/r4",
      clientId: "sandbox-client",
    });
  });

  it("creates a real endpoint only in production off Netlify, and never takes status from the form", async () => {
    productionOffNetlify();
    auth = { ...practice, role: "admin" };
    const host = `ehr-${randomUUID().slice(0, 8)}.example.com`;
    const result = await run(
      createConnectionAction,
      form({
        displayName: "Real EHR",
        baseUrl: `https://${host}/r4`,
        clientId: "client-1",
        mrnIdentifierSystem: `https://${host}/mrn`,
        status: "active",
      }),
    );
    const id = result.redirectedTo!.replace("/settings/integrations/", "");
    expect(await row(id)).toMatchObject({ isSandbox: false, status: "draft", baseUrl: `https://${host}/r4` });

    process.env.NETLIFY = "true"; // a mistaken APP_ENV=production on Netlify stays synthetic-only
    const again = await run(createConnectionAction, form({ displayName: "On Netlify" }));
    const sandboxId = again.redirectedTo!.replace("/settings/integrations/", "");
    expect((await row(sandboxId)).isSandbox).toBe(true);
  });

  it("returns a field-level refusal to the form instead of throwing", async () => {
    productionOffNetlify();
    auth = { ...practice, role: "admin" };
    const result = await run(
      createConnectionAction,
      form({
        displayName: "Bad",
        baseUrl: "http://ehr.example.com/r4",
        clientId: "c",
        mrnIdentifierSystem: "https://ehr.example.com/mrn",
      }),
    );
    expect(result.state).toEqual({ error: "The URL must start with https://.", field: "baseUrl" });
  });

  it("renames a locked connection from a form that omits the disabled endpoint inputs", async () => {
    productionOffNetlify();
    auth = { ...practice, role: "admin" };
    const host = `ehr-${randomUUID().slice(0, 8)}.example.com`;
    const created = await run(
      createConnectionAction,
      form({
        displayName: "Locked EHR",
        baseUrl: `https://${host}/r4`,
        clientId: "client-2",
        mrnIdentifierSystem: `https://${host}/mrn`,
      }),
    );
    const id = created.redirectedTo!.replace("/settings/integrations/", "");
    await systemDb().execute(`update integration_connections set has_synced = true where id = '${id}'`);
    const stamp = (await row(id)).updatedAt.toISOString();
    const result = await run(
      updateConnectionAction,
      form({ id, updatedAt: stamp, displayName: "Locked EHR 2" }),
    );
    expect(result.redirectedTo).toBe(`/settings/integrations/${id}`);
    expect(await row(id)).toMatchObject({ displayName: "Locked EHR 2", baseUrl: `https://${host}/r4` });
  });

  it("revokes only with the confirmation box ticked", async () => {
    auth = { ...practice, role: "admin" };
    const created = await run(createConnectionAction, form({ displayName: "To revoke" }));
    const id = created.redirectedTo!.replace("/settings/integrations/", "");
    const stamp = (await row(id)).updatedAt.toISOString();
    const unconfirmed = await run(
      revokeConnectionAction,
      form({ id, updatedAt: stamp, reason: "no_longer_used" }),
    );
    expect(unconfirmed.state?.error).toMatch(/Check the box/);
    expect((await row(id)).status).toBe("draft");
    const confirmed = await run(
      revokeConnectionAction,
      form({ id, updatedAt: stamp, reason: "no_longer_used", confirm: "on" }),
    );
    expect(confirmed.redirectedTo).toBe(`/settings/integrations/${id}`);
    expect((await row(id)).status).toBe("revoked");
  });

  it("answers 'not found' for another practice's connection or a malformed id", async () => {
    const other = await createTestTenant("Connection actions other");
    auth = { ...other, role: "admin" };
    const created = await run(createConnectionAction, form({ displayName: "Other practice" }));
    const id = created.redirectedTo!.replace("/settings/integrations/", "");
    const stamp = (await row(id)).updatedAt.toISOString();
    auth = { ...practice, role: "admin" };
    for (const target of [id, "not-a-uuid"]) {
      const result = await run(
        revokeConnectionAction,
        form({ id: target, updatedAt: stamp, reason: "no_longer_used", confirm: "on" }),
      );
      expect(result.state?.error).toMatch(/not found/);
    }
    expect((await row(id)).status).toBe("draft");
  });
});
