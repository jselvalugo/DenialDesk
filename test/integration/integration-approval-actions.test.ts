import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { todayIn } from "@rules/calendar";
import { asc, eq } from "drizzle-orm";
import type { OperatorContext } from "@/auth/operator";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, integrationConnections, integrationEndpointRegistry, users } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  createConnection,
  submitConnection,
  type IntegrationActor,
  type SigningDeps,
} from "@/domain/integrations/connections";
import { recordAgreement } from "@/domain/platform/agreements";
import { testConnection, type TxRunner } from "@/domain/integrations/test-connection";
import { en } from "@/i18n/messages/en";
import { es } from "@/i18n/messages/es";
import { EnvSharedKeyStore } from "@/integrations/fhir/keys";
import { FAKE_BASE_URL, FakeFhirTransport } from "../support/fake-fhir-transport";
import { createTestTenant } from "./helpers";

// docs/specs/patient-integrations.md PI1c: the operator console's Approve and Reject server actions,
// run against the real domain and database. Faked: the operator session (`requireOperator`),
// request headers (the language), Next's redirect and cache. R-7.2.4, R-7.5.1, R-11.1.

/** The operator session the action sees; null is "no operator session" (`requireOperator` redirects). */
let session: OperatorContext | null = null;
let language = "en";

vi.mock("@/auth/operator", () => ({
  requireOperator: async () => {
    if (!session) throw new Redirect("/operator/login");
    return session;
  },
}));
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

const { approveIntegration, rejectIntegration } = await import("@/app/operator/(console)/actions");

type Ctx = { tenantId: string; userId: string };
let a: Ctx;
let b: Ctx;
let operator: OperatorContext;

const signingKey = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey;
const keyStore = new EnvSharedKeyStore(
  () => true,
  signingKey.export({ format: "pem", type: "pkcs8" }).toString(),
);
const signing: SigningDeps = { keyStore: () => keyStore };
const admin = (ctx: Ctx): IntegrationActor => ({
  ...ctx,
  role: "admin",
  syntheticOnly: false,
  recentMfa: true,
  stepUpVerifiedAt: new Date(Date.now() - 60_000).toISOString(),
});
const runner =
  (ctx: Ctx): TxRunner =>
  (fn) =>
    withTenant(ctx, fn);

beforeAll(async () => {
  const email = `operator-approval-actions-${randomUUID().slice(0, 8)}@synthetic.test`;
  const [user] = await systemDb()
    .insert(users)
    .values({ email, displayName: "Platform operator", passwordHash: "unused" })
    .returning({ id: users.id });
  operator = { sessionId: randomUUID(), userId: user!.id, displayName: "Platform operator", email };
});
beforeEach(async () => {
  a = await createTestTenant("Approval action A");
  b = await createTestTenant("Approval action B");
  session = operator;
  language = "en";
  // The domain checks the operator by the console's rule (the configured email, no membership), and
  // Approve only runs where real data is allowed: production, off Netlify.
  vi.stubEnv("PLATFORM_OPERATOR_EMAIL", operator.email);
  vi.stubEnv("APP_ENV", "production");
  for (const name of ["NETLIFY", "NETLIFY_DB_URL", "DEPLOY_ID", "SITE_ID"]) vi.stubEnv(name, "");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => closeDatabase());

/** A signed BAA in force for the practice (Approve requires one); synthetic bytes only. */
async function recordBaa(tenantId: string) {
  await recordAgreement(
    {
      tenantId,
      effectiveDate: "2026-01-01",
      expiresOn: null,
      signedOn: "2025-12-31",
      practiceSigner: "Synthetic Signer, Practice Administrator",
      ourSigner: "Synthetic Officer, DenialDesk",
      note: null,
      filename: "synthetic-baa.pdf",
      content: Buffer.from("%PDF-1.7\n% synthetic approval action test\n%%EOF\n", "latin1"),
      attestedSynthetic: false,
    },
    operator,
    { syntheticOnly: false },
  );
}

async function pending(ctx: Ctx, baa = true) {
  if (baa) await recordBaa(ctx.tenantId);
  const { id } = await withTenant(ctx, (tx) =>
    createConnection(tx, admin(ctx), {
      displayName: "Main EHR",
      baseUrl: FAKE_BASE_URL,
      clientId: `client-${randomUUID().slice(0, 8)}`,
      mrnIdentifierSystem: "https://fhir.example.com/mrn",
    }),
  );
  const tested = await testConnection(runner(ctx), admin(ctx), id, {
    transportFor: () => FakeFhirTransport.healthy(),
    keyStore: () => keyStore,
  });
  expect(tested.outcome).toBe("ok");
  await submitConnection(
    runner(ctx),
    admin(ctx),
    id,
    (await row(id)).updatedAt.toISOString(),
    { attested: true, locale: "en" },
    signing,
  );
  return id;
}

async function row(id: string) {
  const [stored] = await systemDb()
    .select()
    .from(integrationConnections)
    .where(eq(integrationConnections.id, id));
  return stored!;
}

async function claimed(id: string) {
  return (
    await systemDb()
      .select({ id: integrationEndpointRegistry.id })
      .from(integrationEndpointRegistry)
      .where(eq(integrationEndpointRegistry.connectionId, id))
  ).length;
}

async function decisions(id: string) {
  const rows = await systemDb()
    .select({ action: auditEvents.action })
    .from(auditEvents)
    .where(eq(auditEvents.entityId, id))
    .orderBy(asc(auditEvents.id));
  return rows.filter((event) => event.action.startsWith("operator.integration_"));
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** Runs an action; a redirect (success, or no operator session) comes back as `{ redirectedTo }`. */
async function run<T>(action: (state: object, data: FormData) => Promise<T>, data: FormData) {
  try {
    return { state: await action({}, data) };
  } catch (error) {
    if (error instanceof Redirect) return { redirectedTo: error.to };
    throw error;
  }
}
const errorOf = (result: { state?: unknown }) => (result.state as { error?: string } | undefined)?.error;

// The console's "today" (a Florida date): the latest a verification can be dated and, for a
// connection submitted just now, also the earliest. Read when a test asks for it, never once at
// module load: a suite that starts before Florida midnight and runs past it would otherwise carry
// yesterday's date into later tests (a verification dated before the submission's Florida date is
// refused). Each test reads it after it made its connection.
const verifiedOnToday = () => todayIn();

async function approveForm(ctx: Ctx, id: string, extra: Record<string, string> = {}) {
  return form({
    tenantId: ctx.tenantId,
    connectionId: id,
    updatedAt: (await row(id)).updatedAt.toISOString(),
    methodCode: "video_call",
    verifiedOn: verifiedOnToday(),
    contactRole: "ehr_administrator",
    populationScope: "group_export",
    clientIdOwnership: "on",
    ...extra,
  });
}

async function rejectForm(ctx: Ctx, id: string, extra: Record<string, string> = {}) {
  return form({
    tenantId: ctx.tenantId,
    connectionId: id,
    updatedAt: (await row(id)).updatedAt.toISOString(),
    reasonCode: "endpoint_not_verified",
    ...extra,
  });
}

describe("approveIntegration", () => {
  it("approves with the operator session: activates, audits, and goes back to the queue", async () => {
    const id = await pending(a);
    const result = await run(approveIntegration, await approveForm(a, id, { mrnNineDigits: "on" }));
    expect(result.redirectedTo).toBe("/operator/integrations?decided=approved");
    expect(await row(id)).toMatchObject({
      status: "active",
      approvedBy: operator.userId,
      approvalMethod: "video_call",
      populationScope: "group_export",
      mrnNineDigitsVerified: true,
    });
    expect((await decisions(id)).map((event) => event.action)).toEqual(["operator.integration_approved"]);
  });

  it("without an operator session (a practice session, an administrator's included) nothing is decided", async () => {
    const id = await pending(a);
    // `requireOperator` reads only the operator session cookie, so a signed-in practice administrator
    // has none: the console sends them to the operator sign-in, before any domain call.
    session = null;
    const result = await run(approveIntegration, await approveForm(a, id));
    expect(result.redirectedTo).toBe("/operator/login");
    const rejected = await run(rejectIntegration, await rejectForm(a, id));
    expect(rejected.redirectedTo).toBe("/operator/login");
    expect(await row(id)).toMatchObject({ status: "pending_approval", approvedBy: null });
    expect(await claimed(id)).toBe(1);
    expect(await decisions(id)).toEqual([]);
  });

  it("refuses a practice user's ID even inside an operator session (the domain checks again)", async () => {
    const id = await pending(a);
    session = { ...operator, userId: a.userId };
    const result = await run(approveIntegration, await approveForm(a, id));
    expect(errorOf(result)).toBe(en.operator["errors.integrationNotOperator"]);
    const rejected = await run(rejectIntegration, await rejectForm(a, id));
    expect(errorOf(rejected)).toBe(en.operator["errors.integrationNotOperator"]);
    expect(await row(id)).toMatchObject({ status: "pending_approval" });
    expect(await claimed(id)).toBe(1);
    expect(await decisions(id)).toEqual([]);
  });

  it.each([
    ["no confirmation", {}],
    ["off", { clientIdOwnership: "off" }],
    ["true", { clientIdOwnership: "true" }],
    ["1", { clientIdOwnership: "1" }],
    ["empty", { clientIdOwnership: "" }],
  ])("needs the client ID ownership checkbox to be `on` (%s)", async (_label, extra) => {
    const id = await pending(a);
    const data = await approveForm(a, id, extra);
    if (_label === "no confirmation") data.delete("clientIdOwnership");
    const result = await run(approveIntegration, data);
    expect(errorOf(result)).toBe(en.operator["errors.approvalOwnershipRequired"]);
    expect((await row(id)).status).toBe("pending_approval");
  });

  it("reads the optional nine-digit confirmation as `on` only", async () => {
    const id = await pending(a);
    await run(approveIntegration, await approveForm(a, id, { mrnNineDigits: "true" }));
    expect((await row(id)).mrnNineDigitsVerified).toBe(false);
    const other = await pending(b);
    await run(approveIntegration, await approveForm(b, other));
    expect((await row(other)).mrnNineDigitsVerified).toBe(false);
  });

  it.each([
    ["a tenant that isn't a UUID", { tenantId: "not-a-uuid" }],
    ["a connection that isn't a UUID", { connectionId: "not-a-uuid" }],
    ["a missing connection", { connectionId: "" }],
  ])("refuses %s as an invalid request", async (_label, extra) => {
    const id = await pending(a);
    const result = await run(approveIntegration, await approveForm(a, id, extra));
    expect(errorOf(result)).toBe(en.operator["errors.invalidRequest"]);
    expect((await row(id)).status).toBe("pending_approval");
  });

  it("names the practice: another practice's ID is not found and nothing changes", async () => {
    const id = await pending(a);
    const other = await pending(b);
    const result = await run(approveIntegration, await approveForm(a, id, { tenantId: b.tenantId }));
    expect(errorOf(result)).toBe(en.operator["errors.integrationNotFound"]);
    expect((await row(id)).status).toBe("pending_approval");
    expect((await row(other)).status).toBe("pending_approval");
  });

  it("shows the refusals in the operator's language", async () => {
    const id = await pending(a);
    language = "es";
    const result = await run(approveIntegration, await approveForm(a, id, { methodCode: "" }));
    expect(errorOf(result)).toBe(es.operator["errors.approvalFormInvalid"]);
    expect(errorOf(result)).not.toBe(en.operator["errors.approvalFormInvalid"]);
  });

  it("refuses a verified search filter in words, and approves the Group export", async () => {
    const id = await pending(a);
    const refused = await run(
      approveIntegration,
      await approveForm(a, id, { populationScope: "verified_filter" }),
    );
    expect(errorOf(refused)).toBe(en.operator["errors.approvalScopeUnsupported"]);
    expect((await row(id)).status).toBe("pending_approval");
    const approved = await run(approveIntegration, await approveForm(a, id));
    expect(approved.redirectedTo).toBe("/operator/integrations?decided=approved");
  });

  it("refuses where only synthetic data is allowed (the server's environment, not the request's)", async () => {
    const id = await pending(a);
    vi.stubEnv("APP_ENV", "development");
    const result = await run(approveIntegration, await approveForm(a, id));
    expect(errorOf(result)).toBe(en.operator["errors.integrationRealEndpointRefused"]);
    expect((await row(id)).status).toBe("pending_approval");
  });

  it("refuses a practice without a Business Associate Agreement in force", async () => {
    const id = await pending(a, false);
    const result = await run(approveIntegration, await approveForm(a, id));
    expect(errorOf(result)).toBe(en.operator["errors.approvalBaaRequired"]);
    expect((await row(id)).status).toBe("pending_approval");
  });

  it("reads the verification date whole: a long or malformed value is refused, never truncated into a valid one", async () => {
    const id = await pending(a);
    const day = verifiedOnToday();
    for (const verifiedOn of [`${day}T00:00:00Z`, `${day}xxxx`, `${day}${" ".repeat(20)}9`]) {
      const result = await run(approveIntegration, await approveForm(a, id, { verifiedOn }));
      expect(errorOf(result)).toBe(en.operator["errors.approvalDateInvalid"]);
    }
    expect((await row(id)).status).toBe("pending_approval");
  });

  it("a page opened before the practice changed the connection is refused as stale", async () => {
    const id = await pending(a);
    const data = await approveForm(a, id, { updatedAt: "2020-01-01T00:00:00.000Z" });
    const result = await run(approveIntegration, data);
    expect(errorOf(result)).toBe(en.operator["errors.integrationStale"]);
    expect((await row(id)).status).toBe("pending_approval");
  });
});

describe("rejectIntegration", () => {
  it("rejects with the operator session: back to draft, claim released, audited, back to the queue", async () => {
    const id = await pending(a);
    const result = await run(
      rejectIntegration,
      await rejectForm(a, id, { reasonCode: "contact_not_verified" }),
    );
    expect(result.redirectedTo).toBe("/operator/integrations?decided=rejected");
    expect(await row(id)).toMatchObject({ status: "draft", statusReason: "contact_not_verified" });
    expect(await claimed(id)).toBe(0);
    expect((await decisions(id)).map((event) => event.action)).toEqual(["operator.integration_rejected"]);
  });

  it.each(["", "free text about a patient", "OTHER"])(
    "takes only a listed reason: %j is refused and the connection stays pending and claimed",
    async (reasonCode) => {
      const id = await pending(a);
      const result = await run(rejectIntegration, await rejectForm(a, id, { reasonCode }));
      expect(errorOf(result)).toBe(en.operator["errors.rejectReasonRequired"]);
      expect((await row(id)).status).toBe("pending_approval");
      expect(await claimed(id)).toBe(1);
    },
  );

  it("names the practice and refuses an invalid request", async () => {
    const id = await pending(a);
    const wrong = await run(rejectIntegration, await rejectForm(a, id, { tenantId: b.tenantId }));
    expect(errorOf(wrong)).toBe(en.operator["errors.integrationNotFound"]);
    const invalid = await run(rejectIntegration, await rejectForm(a, id, { connectionId: "nope" }));
    expect(errorOf(invalid)).toBe(en.operator["errors.invalidRequest"]);
    expect((await row(id)).status).toBe("pending_approval");
    expect(await claimed(id)).toBe(1);
  });
});
