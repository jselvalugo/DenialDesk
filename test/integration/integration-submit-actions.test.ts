import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq, sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, integrationConnections, integrationEndpointRegistry } from "@/db/schema";
import { withTenant, withTenantAsPlatform } from "@/db/tenant";
import { EnvSharedKeyStore } from "@/integrations/fhir/keys";
import { FAKE_BASE_URL, FAKE_TOKEN_ENDPOINT, FakeFhirTransport } from "../support/fake-fhir-transport";
import { createTestTenant } from "./helpers";

// docs/specs/patient-integrations.md PI2a: the Submit and Resume server actions, run against the real
// domain and database. Faked: the session, request headers (the language), Next's redirect, and the
// Test connection wiring (a fake server and a key generated here, since production has no key store
// until the Azure cutover). R-7.2.2, R-7.2.4, R-7.5.1, R-3.3.1.

type Role = "admin" | "manager" | "specialist" | "compliance";
let auth: { tenantId: string; userId: string; role: Role; mfaVerifiedAt?: Date | null };
let language = "en";
const wiring = vi.hoisted(() => ({ transport: undefined as unknown, keyStore: undefined as unknown }));

vi.mock("@/auth/session", () => ({ requireAuth: async () => auth }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ "accept-language": language }),
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
// The same shape as the real wiring: the transport is chosen from is_sandbox alone (the built-in
// sandbox has none until PI2b), the key store is the environment adapter over the key made below.
vi.mock("@/app/(app)/settings/integrations/test-deps", () => ({
  connectionTestDeps: () => ({
    transportFor: (connection: { isSandbox: boolean }) => (connection.isSandbox ? null : wiring.transport),
    keyStore: () => wiring.keyStore,
  }),
}));

const {
  createConnectionAction,
  pauseConnectionAction,
  resumeConnectionAction,
  submitConnectionAction,
  testConnectionAction,
  withdrawConnectionAction,
} = await import("@/app/(app)/settings/integrations/actions");

const signingKey = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey;
wiring.keyStore = new EnvSharedKeyStore(
  () => true,
  signingKey.export({ format: "pem", type: "pkcs8" }).toString(),
);
const serve = (transport: FakeFhirTransport) => {
  wiring.transport = transport;
};
const failingToken = () =>
  FakeFhirTransport.healthy().set(`POST ${FAKE_TOKEN_ENDPOINT}`, {
    status: 401,
    contentType: undefined,
    body: "",
  });

const savedEnv = { ...process.env };
function productionOffNetlify() {
  process.env.APP_ENV = "production";
  for (const key of ["NETLIFY", "NETLIFY_DB_URL", "DEPLOY_ID", "SITE_ID"]) delete process.env[key];
}
beforeEach(() => {
  language = "en";
  serve(FakeFhirTransport.healthy());
});
afterEach(() => {
  process.env = { ...savedEnv };
});
afterAll(() => closeDatabase());

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

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
const errorOf = (result: { state?: unknown }) => (result.state as { error?: string } | undefined)?.error;

async function row(id: string) {
  const [stored] = await systemDb()
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id));
  return stored!;
}
const stampOf = async (id: string) => (await row(id)).updatedAt.toISOString();

async function audits(id: string, action: string) {
  const rows = await systemDb()
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.entityId, id))
    .orderBy(asc(auditEvents.id));
  return rows.filter((event) => event.action === action);
}

type Ctx = { tenantId: string; userId: string };

/** A fresh practice signed in as an administrator with a step-up just done, and one real draft. */
async function realDraft(clientId = `client-${randomUUID().slice(0, 8)}`) {
  productionOffNetlify();
  const ctx = await createTestTenant("Submit actions");
  auth = { ...ctx, role: "admin", mfaVerifiedAt: new Date() };
  const created = await run(
    createConnectionAction,
    form({
      displayName: "Main EHR",
      baseUrl: FAKE_BASE_URL,
      clientId,
      mrnIdentifierSystem: "https://fhir.example.com/mrn",
    }),
  );
  return { ctx, clientId, id: created.redirectedTo!.replace("/settings/integrations/", "") };
}

async function passTest(id: string) {
  serve(FakeFhirTransport.healthy());
  const result = await run(testConnectionAction, form({ id }));
  expect(result.state).toMatchObject({ outcome: "ok" });
}

const submitForm = async (id: string, extra: Record<string, string> = {}) =>
  form({ id, updatedAt: await stampOf(id), attest: "on", locale: language, ...extra });

/** The operator's approval (PI1c has not shipped): table-owner privileges, as in the lifecycle tests. */
async function approve(ctx: Ctx, id: string) {
  await withTenantAsPlatform(ctx, (tx) =>
    tx.execute(sql`
      update integration_connections
      set status = 'active', approved_by = ${ctx.userId}::uuid, approved_at = now(),
          approval_method = 'phone_verified', population_scope = 'verified_filter'
      where id = ${id}::uuid
    `),
  );
}

describe("submitConnectionAction (PI2a)", () => {
  it("refuses every role but administrator, writing nothing", async () => {
    const { ctx, id } = await realDraft();
    await passTest(id);
    for (const role of ["manager", "specialist", "compliance"] as const) {
      auth = { ...ctx, role, mfaVerifiedAt: new Date() };
      const result = await run(submitConnectionAction, await submitForm(id));
      expect(errorOf(result)).toMatch(/Only an administrator/);
    }
    expect(await row(id)).toMatchObject({ status: "draft", submittedAt: null });
  });

  it("answers 'not found' for a malformed id and for another practice's connection", async () => {
    const { id } = await realDraft();
    await passTest(id);
    const form1 = await submitForm(id);
    const other = await createTestTenant("Submit actions other");
    auth = { ...other, role: "admin", mfaVerifiedAt: new Date() };
    for (const target of [id, "not-a-uuid"]) {
      form1.set("id", target);
      expect(errorOf(await run(submitConnectionAction, form1))).toMatch(/not found/);
    }
    expect(await row(id)).toMatchObject({ status: "draft", submittedAt: null });
  });

  it("refuses without a passing Test connection, and after a failed one", async () => {
    const { id } = await realDraft();
    const untested = await run(submitConnectionAction, await submitForm(id));
    expect(errorOf(untested)).toMatch(/Test connection has to pass first/);
    expect(untested.state).not.toMatchObject({ stepUpRequired: true });

    await passTest(id);
    serve(failingToken());
    const failed = await run(testConnectionAction, form({ id }));
    expect(failed.state).toMatchObject({ outcome: "auth_refused" });
    expect(errorOf(await run(submitConnectionAction, await submitForm(id)))).toMatch(
      /Test connection has to pass first/,
    );
    expect(await row(id)).toMatchObject({ status: "draft", submittedAt: null });
  });

  it("asks for a step-up when the last verification is stale or missing, ignoring anything the form says", async () => {
    const { ctx, id } = await realDraft();
    await passTest(id);
    for (const mfaVerifiedAt of [minutesAgo(6), null, undefined]) {
      auth = { ...ctx, role: "admin", mfaVerifiedAt };
      const refused = await run(
        submitConnectionAction,
        await submitForm(id, { recentMfa: "true", mfaVerifiedAt: new Date().toISOString() }),
      );
      expect(refused.state).toMatchObject({ stepUpRequired: true });
      expect(errorOf(refused)).toMatch(/two-step verification/);
    }
    expect((await row(id)).status).toBe("draft");
  });

  it("refuses without the attestation checkbox, on that field: only 'on' counts", async () => {
    const { id } = await realDraft();
    await passTest(id);
    for (const attest of [undefined, "", "true", "yes", "off"]) {
      const data = await submitForm(id);
      if (attest === undefined) data.delete("attest");
      else data.set("attest", attest);
      const result = await run(submitConnectionAction, data);
      expect(result.state).toMatchObject({ field: "attestation" });
      expect(errorOf(result)).toMatch(/only in the United States/);
    }
    expect(await row(id)).toMatchObject({ status: "draft", usResidencyAttestedAt: null });
  });

  it("submits a tested real connection: pending approval, both stamps, the registry claimed, the page redirected", async () => {
    const { ctx, id, clientId } = await realDraft();
    await passTest(id);
    const result = await run(
      submitConnectionAction,
      // Extra fields are ignored: none of these can set a status, a tenant, or an approval.
      await submitForm(id, {
        status: "active",
        tenantId: randomUUID(),
        approvedBy: ctx.userId,
        submittedBy: randomUUID(),
      }),
    );
    expect(result.redirectedTo).toBe(`/settings/integrations/${id}`);
    const stored = await row(id);
    expect(stored).toMatchObject({
      status: "pending_approval",
      submittedBy: ctx.userId,
      usResidencyAttestedBy: ctx.userId,
      approvedBy: null,
      tenantId: ctx.tenantId,
    });
    expect(stored.usResidencyAttestedAt!.toISOString()).toBe(stored.submittedAt!.toISOString());
    const registry = await systemDb()
      .select()
      .from(integrationEndpointRegistry)
      .where(eq(integrationEndpointRegistry.connectionId, id));
    expect(registry).toHaveLength(1);
    expect(registry[0]).toMatchObject({ endpointKey: FAKE_BASE_URL, clientId });
    const [event] = await audits(id, "integration.connection_submitted");
    expect(event!.metadata).toMatchObject({
      status: "pending_approval",
      attestation_locale: "en",
      us_residency_attested: true,
    });
  });

  it("records the language the attestation was shown in", async () => {
    const { id } = await realDraft();
    await passTest(id);
    language = "es";
    const result = await run(submitConnectionAction, await submitForm(id));
    expect(result.redirectedTo).toBe(`/settings/integrations/${id}`);
    const [event] = await audits(id, "integration.connection_submitted");
    expect(event!.metadata).toMatchObject({ attestation_locale: "es", attestation_version: 1 });
  });

  it("refuses a form whose displayed language no longer matches the request's, or that names none", async () => {
    const { id } = await realDraft();
    await passTest(id);
    // The page was rendered in Spanish; the language was switched to English before the click.
    for (const locale of ["es", "pt", "fr", ""]) {
      const result = await run(submitConnectionAction, await submitForm(id, { locale }));
      expect(errorOf(result)).toMatch(/page language changed/);
    }
    const data = await submitForm(id);
    data.delete("locale");
    expect(errorOf(await run(submitConnectionAction, data))).toMatch(/page language changed/);
    expect(await row(id)).toMatchObject({ status: "draft", submittedAt: null, usResidencyAttestedAt: null });
    // Refused before anything else happens: not counted against the practice's Submit limit, no audit.
    expect(await audits(id, "integration.connection_submitted")).toEqual([]);
    expect(errorOf(await run(submitConnectionAction, await submitForm(id)))).toBeUndefined();
  });

  it("refuses in words while another connection of the practice is submitted or active, and shows no save error", async () => {
    const first = await realDraft();
    await passTest(first.id);
    await run(submitConnectionAction, await submitForm(first.id));

    // A second draft in the same practice (still signed in as its administrator).
    const created = await run(
      createConnectionAction,
      form({
        displayName: "Second EHR",
        baseUrl: FAKE_BASE_URL,
        clientId: `client-${randomUUID().slice(0, 8)}`,
        mrnIdentifierSystem: "https://fhir.example.com/mrn",
      }),
    );
    const second = created.redirectedTo!.replace("/settings/integrations/", "");
    await passTest(second);
    const refused = await run(submitConnectionAction, await submitForm(second));
    expect(errorOf(refused)).toMatch(/Another connection is already submitted or active/);
    expect(errorOf(refused)).not.toMatch(/couldn't be saved/);
    expect(await row(second)).toMatchObject({ status: "draft", submittedAt: null });
    expect((await row(first.id)).status).toBe("pending_approval");
  });

  it("refuses a second practice's identical endpoint and client ID in the spec's words, and audits it", async () => {
    const clientId = `shared-${randomUUID().slice(0, 8)}`;
    const first = await realDraft(clientId);
    await passTest(first.id);
    expect((await run(submitConnectionAction, await submitForm(first.id))).redirectedTo).toBeDefined();

    const second = await realDraft(clientId);
    await passTest(second.id);
    const refused = await run(submitConnectionAction, await submitForm(second.id));
    expect(errorOf(refused)).toBe("This endpoint and client ID are already connected");
    expect((refused.state as { field?: string }).field).toBeUndefined();
    expect(await row(second.id)).toMatchObject({ status: "draft", submittedAt: null });
    const conflicts = await audits(second.id, "integration.registry_conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ tenantId: second.ctx.tenantId, actorUserId: second.ctx.userId });
    expect(JSON.stringify(conflicts[0]!.metadata)).not.toContain(first.ctx.tenantId);
    expect((await row(first.id)).status).toBe("pending_approval");
  });

  it("withdraw, then submit again: refused until there is a fresh test", async () => {
    const { id } = await realDraft();
    await passTest(id);
    await run(submitConnectionAction, await submitForm(id));
    const withdrawn = await run(withdrawConnectionAction, form({ id, updatedAt: await stampOf(id) }));
    expect(withdrawn.redirectedTo).toBe(`/settings/integrations/${id}`);
    expect(await row(id)).toMatchObject({ status: "draft", usResidencyAttestedAt: null });
    expect(errorOf(await run(submitConnectionAction, await submitForm(id)))).toMatch(
      /Test connection has to pass first/,
    );
    await passTest(id);
    expect((await run(submitConnectionAction, await submitForm(id))).redirectedTo).toBeDefined();
  });

  it("can't submit the built-in sandbox yet: it needs a passing test, and the sandbox can't be tested until PI2b", async () => {
    // Where only synthetic data is allowed (the test environment's default): Create makes the sandbox.
    const ctx = await createTestTenant("Submit sandbox action");
    auth = { ...ctx, role: "admin", mfaVerifiedAt: new Date() };
    const created = await run(createConnectionAction, form({ displayName: "Sandbox" }));
    const id = created.redirectedTo!.replace("/settings/integrations/", "");
    expect((await run(testConnectionAction, form({ id }))).state).toMatchObject({
      error: expect.stringMatching(/can't be tested yet/),
    });
    const refused = await run(submitConnectionAction, form({ id, updatedAt: await stampOf(id) }));
    expect(errorOf(refused)).toMatch(/Test connection has to pass first/);
    expect(await row(id)).toMatchObject({ status: "draft", submittedAt: null });
  });
});

describe("resumeConnectionAction from error (PI2a)", () => {
  async function erroredConnection() {
    const draft = await realDraft();
    await passTest(draft.id);
    await run(submitConnectionAction, await submitForm(draft.id));
    await approve(draft.ctx, draft.id);
    await withTenant(draft.ctx, (tx) =>
      tx.execute(sql`
        update integration_connections set status = 'error', status_reason = 'auth_failed', updated_at = now()
        where id = ${draft.id}::uuid
      `),
    );
    return draft;
  }

  it("is refused while the newest test failed, then works after a new pass, clearing the reason", async () => {
    const { id } = await erroredConnection();
    serve(failingToken());
    expect((await run(testConnectionAction, form({ id }))).state).toMatchObject({ outcome: "auth_refused" });

    const refused = await run(resumeConnectionAction, form({ id, updatedAt: await stampOf(id) }));
    expect(errorOf(refused)).toMatch(/Run Test connection and get a pass before resuming/);
    expect(refused.state).not.toMatchObject({ stepUpRequired: true });
    expect(await row(id)).toMatchObject({ status: "error", statusReason: "auth_failed" });

    await passTest(id);
    const resumed = await run(resumeConnectionAction, form({ id, updatedAt: await stampOf(id) }));
    expect(resumed.redirectedTo).toBe(`/settings/integrations/${id}`);
    expect(await row(id)).toMatchObject({ status: "active", statusReason: null });
  });

  it("is refused right after the error, since the pass on record came before it; a new pass allows it", async () => {
    const { id } = await erroredConnection();
    const refused = await run(resumeConnectionAction, form({ id, updatedAt: await stampOf(id) }));
    expect(errorOf(refused)).toMatch(/Run Test connection and get a pass before resuming/);
    expect(await row(id)).toMatchObject({ status: "error", statusReason: "auth_failed" });

    await passTest(id);
    const resumed = await run(resumeConnectionAction, form({ id, updatedAt: await stampOf(id) }));
    expect(resumed.redirectedTo).toBe(`/settings/integrations/${id}`);
    expect((await row(id)).status).toBe("active");
  });

  it("still needs the step-up, and says so", async () => {
    const draft = await erroredConnection();
    auth = { ...draft.ctx, role: "admin", mfaVerifiedAt: minutesAgo(6) };
    const refused = await run(
      resumeConnectionAction,
      form({ id: draft.id, updatedAt: await stampOf(draft.id) }),
    );
    expect(refused.state).toMatchObject({ stepUpRequired: true });
    expect((await row(draft.id)).status).toBe("error");
  });

  it("resuming from paused needs no test", async () => {
    const { ctx, id } = await erroredConnection();
    await withTenant(ctx, (tx) =>
      tx.execute(sql`update integration_connections set status = 'active' where id = ${id}::uuid`),
    );
    const paused = await run(pauseConnectionAction, form({ id, updatedAt: await stampOf(id) }));
    expect(paused.redirectedTo).toBeDefined();
    serve(failingToken());
    await run(testConnectionAction, form({ id }));
    const resumed = await run(resumeConnectionAction, form({ id, updatedAt: await stampOf(id) }));
    expect(resumed.redirectedTo).toBe(`/settings/integrations/${id}`);
    expect((await row(id)).status).toBe("active");
  });
});
