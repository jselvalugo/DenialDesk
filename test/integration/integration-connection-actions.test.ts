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
let auth: { tenantId: string; userId: string; role: Role; mfaVerifiedAt?: Date | null };

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

const {
  createConnectionAction,
  pauseConnectionAction,
  resumeConnectionAction,
  revokeConnectionAction,
  submitConnectionAction,
  updateConnectionAction,
  withdrawConnectionAction,
} = await import("@/app/(app)/settings/integrations/actions");

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
        [revokeConnectionAction, form({ id, updatedAt: stamp, reason: "other", confirm: "on" })],
        [pauseConnectionAction, form({ id, updatedAt: stamp })],
        [resumeConnectionAction, form({ id, updatedAt: stamp })],
        [withdrawConnectionAction, form({ id, updatedAt: stamp })],
        [submitConnectionAction, form({ id, updatedAt: stamp, attest: "on" })],
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

describe("Pause, resume, withdraw, and the revoke reason (PI2a)", () => {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

  /** A fresh practice with a built-in sandbox connection (where only synthetic data is allowed), moved to `status`. */
  async function sandboxIn(status: "active" | "paused") {
    const ctx = await createTestTenant("Lifecycle actions");
    auth = { ...ctx, role: "admin" };
    const created = await run(createConnectionAction, form({ displayName: "Lifecycle sandbox" }));
    const id = created.redirectedTo!.replace("/settings/integrations/", "");
    // The owner stands in for sandbox Submit (PI2b): the lifecycle trigger allows draft -> active.
    await systemDb()
      .update(integrationConnections)
      .set({ status: "active" })
      .where(eq(integrationConnections.id, id));
    if (status === "paused") {
      await systemDb()
        .update(integrationConnections)
        .set({ status: "paused" })
        .where(eq(integrationConnections.id, id));
    }
    return { ctx, id };
  }

  const stampOf = async (id: string) => (await row(id)).updatedAt.toISOString();

  it("resume asks for a step-up when the last verification is stale or missing, and works after a fresh one", async () => {
    const { ctx, id } = await sandboxIn("paused");
    for (const mfaVerifiedAt of [minutesAgo(6), null, undefined]) {
      auth = { ...ctx, role: "admin", mfaVerifiedAt };
      const refused = await run(resumeConnectionAction, form({ id, updatedAt: await stampOf(id) }));
      expect(refused.state).toMatchObject({ stepUpRequired: true });
      expect((refused.state as { error?: string }).error).toMatch(/two-step verification/);
      expect((await row(id)).status).toBe("paused");
    }
    // Comfortably inside the window (4:54) and just after a step-up (now).
    for (const fresh of [minutesAgo(4.9), new Date()]) {
      await systemDb()
        .update(integrationConnections)
        .set({ status: "paused" })
        .where(eq(integrationConnections.id, id));
      auth = { ...ctx, role: "admin", mfaVerifiedAt: fresh };
      const resumed = await run(resumeConnectionAction, form({ id, updatedAt: await stampOf(id) }));
      expect(resumed.redirectedTo).toBe(`/settings/integrations/${id}`);
      expect((await row(id)).status).toBe("active");
    }
  });

  it("resume can't be pushed through with a step-up value from the form", async () => {
    const { ctx, id } = await sandboxIn("paused");
    auth = { ...ctx, role: "admin", mfaVerifiedAt: minutesAgo(30) };
    const refused = await run(
      resumeConnectionAction,
      form({ id, updatedAt: await stampOf(id), recentMfa: "true", mfaVerifiedAt: new Date().toISOString() }),
    );
    expect(refused.state).toMatchObject({ stepUpRequired: true });
    expect((await row(id)).status).toBe("paused");
  });

  it("pause needs no step-up", async () => {
    const { ctx, id } = await sandboxIn("active");
    auth = { ...ctx, role: "admin", mfaVerifiedAt: null };
    const paused = await run(pauseConnectionAction, form({ id, updatedAt: await stampOf(id) }));
    expect(paused.redirectedTo).toBe(`/settings/integrations/${id}`);
    expect((await row(id)).status).toBe("paused");
  });

  it("pause, resume, and withdraw answer 'not found' for another practice's connection or a malformed id", async () => {
    const { id } = await sandboxIn("paused");
    const stamp = await stampOf(id);
    const other = await createTestTenant("Lifecycle actions other");
    auth = { ...other, role: "admin", mfaVerifiedAt: new Date() };
    for (const action of [
      pauseConnectionAction,
      resumeConnectionAction,
      withdrawConnectionAction,
      submitConnectionAction,
    ]) {
      for (const target of [id, "not-a-uuid"]) {
        // Submit also carries the language and wording version its attestation was shown in; the
        // action checks both after the role and the id, before it calls the domain.
        const result = await run(
          action,
          form({ id: target, updatedAt: stamp, locale: "en", attestationVersion: "1" }),
        );
        expect(result.state?.error).toMatch(/not found/);
      }
    }
    expect((await row(id)).status).toBe("paused");
  });

  it("revoke without a reason (or with one outside the list) is refused on the reason field, writing nothing", async () => {
    const ctx = await createTestTenant("Revoke reason");
    auth = { ...ctx, role: "admin" };
    const created = await run(createConnectionAction, form({ displayName: "To revoke, no reason" }));
    const id = created.redirectedTo!.replace("/settings/integrations/", "");
    const stamp = await stampOf(id);
    for (const fields of [{}, { reason: "" }, { reason: "because Jane Doe left" }] as Record<
      string,
      string
    >[]) {
      const result = await run(
        revokeConnectionAction,
        form({ id, updatedAt: stamp, confirm: "on", ...fields }),
      );
      expect(result.state).toMatchObject({ field: "reason" });
      expect((result.state as { error?: string }).error).toMatch(/Choose why/);
    }
    expect((await row(id)).status).toBe("draft");
    const revoked = await run(
      revokeConnectionAction,
      form({ id, updatedAt: stamp, confirm: "on", reason: "switching_systems" }),
    );
    expect(revoked.redirectedTo).toBe(`/settings/integrations/${id}`);
    expect(await row(id)).toMatchObject({ status: "revoked", statusReason: "switching_systems" });
  });
});
