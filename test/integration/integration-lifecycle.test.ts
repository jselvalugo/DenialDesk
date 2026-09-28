import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq, sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, integrationConnections, integrationEndpointRegistry } from "@/db/schema";
import { withTenant, withTenantAsPlatform } from "@/db/tenant";
import {
  createConnection,
  createSandboxConnection,
  getConnection,
  IntegrationConnectionError,
  pauseConnection,
  resumeConnection,
  revokeConnection,
  updateConnection,
  withdrawConnection,
  type ConnectionStatus,
  type IntegrationActor,
} from "@/domain/integrations/connections";
import { REVOKE_REASON_CODES } from "@/domain/integrations/revoke-reasons";
import { createTestTenant, expectDbError } from "./helpers";

// docs/specs/patient-integrations.md PI2a: pause, resume (step-up), withdraw, revoke with a reason
// code, and the database CHECKs tying the registry keys to their URLs. Every transition is
// admin-only, tenant-scoped (a practice can't see or move another's connection), audited, and
// environment-rule checked. R-7.2.2, R-7.2.4, R-7.5.1.

type Ctx = { tenantId: string; userId: string };
let a: Ctx;
let b: Ctx;

/** Production-shaped admin (real endpoints allowed) unless `synthetic`; no recent MFA unless asked. */
const admin = (ctx: Ctx, options: { synthetic?: boolean; mfa?: boolean } = {}): IntegrationActor => ({
  ...ctx,
  role: "admin",
  syntheticOnly: options.synthetic ?? false,
  recentMfa: options.mfa ?? false,
});

beforeAll(async () => {
  a = await createTestTenant("Lifecycle A");
  b = await createTestTenant("Lifecycle B");
});
afterAll(() => closeDatabase());

function endpoint(overrides: Record<string, unknown> = {}) {
  const host = `ehr-${randomUUID().slice(0, 8)}.example.com`;
  return {
    displayName: "Main EHR",
    baseUrl: `https://${host}/api/FHIR/R4/`,
    clientId: `client-${randomUUID().slice(0, 8)}`,
    mrnIdentifierSystem: `https://${host}/mrn`,
    ...overrides,
  };
}

async function refusal(promise: Promise<unknown>): Promise<IntegrationConnectionError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IntegrationConnectionError) return error;
    throw error;
  }
  throw new Error("Expected an IntegrationConnectionError, but the call succeeded");
}

const detail = async (ctx: Ctx, id: string) => (await withTenant(ctx, (tx) => getConnection(tx, id)))!;
const stamp = async (ctx: Ctx, id: string) => (await detail(ctx, id)).updatedAt.toISOString();

async function lastAudit(entityId: string) {
  const [event] = await systemDb()
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.entityId, entityId))
    .orderBy(desc(auditEvents.id))
    .limit(1);
  return event!;
}

async function auditCount(entityId: string) {
  const rows = await systemDb()
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(eq(auditEvents.entityId, entityId));
  return rows.length;
}

/** A status change made the way the system does (the app role's UPDATE grant), not by these actions. */
async function setStatus(ctx: Ctx, id: string, status: ConnectionStatus, reason: string | null = null) {
  await withTenant(ctx, (tx) =>
    tx.execute(sql`
      update integration_connections set status = ${status}::integration_connection_status,
        status_reason = ${reason}, updated_at = now()
      where id = ${id}::uuid
    `),
  );
}

/** Stand-ins for discovery, Submit (PI2a-2), and the registry claim. */
async function submit(ctx: Ctx, id: string) {
  const tokenEndpoint = `https://auth-${randomUUID().slice(0, 8)}.example.com/token`;
  await withTenant(ctx, async (tx) => {
    await tx.execute(sql`
      update integration_connections
      set token_endpoint = ${tokenEndpoint}, token_endpoint_key = ${tokenEndpoint}
      where id = ${id}::uuid
    `);
    await tx.execute(sql`
      update integration_connections
      set status = 'pending_approval', submitted_by = ${ctx.userId}::uuid, submitted_at = now(),
          us_residency_attested_by = ${ctx.userId}::uuid, us_residency_attested_at = now()
      where id = ${id}::uuid
    `);
    await tx.execute(sql`select integration_registry_claim(${id}::uuid)`);
  });
}

/** The operator's approval (PI1c): table-owner privileges, since the app role can't activate. */
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

/** A fresh practice with one real connection, in the requested state. */
async function realConnection(
  state: "draft" | "pending_approval" | "active" | "paused" | "error",
): Promise<{ ctx: Ctx; id: string }> {
  const ctx = await createTestTenant(`Lifecycle ${state}`);
  const { id } = await withTenant(ctx, (tx) => createConnection(tx, admin(ctx), endpoint()));
  if (state === "draft") return { ctx, id };
  await submit(ctx, id);
  if (state === "pending_approval") return { ctx, id };
  await approve(ctx, id);
  if (state === "paused") await setStatus(ctx, id, "paused");
  if (state === "error") await setStatus(ctx, id, "error", "auth_failed");
  return { ctx, id };
}

async function sandboxConnection(state: "draft" | "active" | "paused") {
  const ctx = await createTestTenant(`Lifecycle sandbox ${state}`);
  const { id } = await withTenant(ctx, (tx) =>
    createSandboxConnection(tx, admin(ctx, { synthetic: true }), { displayName: "Sandbox" }),
  );
  if (state !== "draft") await setStatus(ctx, id, "active");
  if (state === "paused") await setStatus(ctx, id, "paused");
  return { ctx, id };
}

describe("pauseConnection", () => {
  it("moves an active connection to paused and audits who, from what, and where", async () => {
    const { ctx, id } = await realConnection("active");
    await withTenant(ctx, async (tx) =>
      pauseConnection(tx, admin(ctx), id, (await getConnection(tx, id))!.updatedAt.toISOString()),
    );
    expect((await detail(ctx, id)).status).toBe("paused");
    expect(await lastAudit(id)).toMatchObject({
      action: "integration.connection_paused",
      actorUserId: ctx.userId,
      tenantId: ctx.tenantId,
      entityType: "integration_connection",
      metadata: { previous_status: "active", sandbox: false },
    });
    const [row] = await systemDb()
      .select({ updatedBy: integrationConnections.updatedBy })
      .from(integrationConnections)
      .where(eq(integrationConnections.id, id));
    expect(row!.updatedBy).toBe(ctx.userId);
  });

  it("needs no step-up (pausing is the safe direction)", async () => {
    const { ctx, id } = await realConnection("active");
    await withTenant(ctx, async (tx) =>
      pauseConnection(
        tx,
        admin(ctx, { mfa: false }),
        id,
        (await getConnection(tx, id))!.updatedAt.toISOString(),
      ),
    );
    expect((await detail(ctx, id)).status).toBe("paused");
  });

  it.each(["draft", "pending_approval", "paused", "error"] as const)(
    "refuses a %s connection, writing and auditing nothing",
    async (state) => {
      const { ctx, id } = await realConnection(state);
      const before = await auditCount(id);
      const error = await refusal(
        withTenant(ctx, async (tx) => pauseConnection(tx, admin(ctx), id, await stamp(ctx, id))),
      );
      expect(error.message).toMatch(/isn't in a state where that is possible/);
      expect((await detail(ctx, id)).status).toBe(state);
      expect(await auditCount(id)).toBe(before);
    },
  );

  it("refuses anyone but an administrator", async () => {
    const { ctx, id } = await realConnection("active");
    const error = await refusal(
      withTenant(ctx, async (tx) =>
        pauseConnection(tx, { ...admin(ctx), role: "specialist" }, id, await stamp(ctx, id)),
      ),
    );
    expect(error.message).toMatch(/administrator/);
    expect((await detail(ctx, id)).status).toBe("active");
  });

  it("refuses a stale page", async () => {
    const { ctx, id } = await realConnection("active");
    const opened = await stamp(ctx, id);
    await withTenant(ctx, (tx) =>
      updateConnection(tx, admin(ctx), id, opened, { displayName: "Renamed since the page opened" }),
    );
    const error = await refusal(withTenant(ctx, (tx) => pauseConnection(tx, admin(ctx), id, opened)));
    expect(error.message).toMatch(/changed since you opened it/);
    expect((await detail(ctx, id)).status).toBe("active");
  });

  it("is not found across practices: practice B can't pause practice A's connection", async () => {
    const { ctx, id } = await realConnection("active");
    const opened = await stamp(ctx, id);
    const before = await auditCount(id);
    const error = await refusal(withTenant(b, (tx) => pauseConnection(tx, admin(b), id, opened)));
    expect(error.message).toMatch(/not found/);
    expect((await detail(ctx, id)).status).toBe("active");
    expect(await auditCount(id)).toBe(before);
  });

  it("applies the environment rule: a real connection where only synthetic data is allowed, and the sandbox in production", async () => {
    const real = await realConnection("active");
    const realError = await refusal(
      withTenant(real.ctx, async (tx) =>
        pauseConnection(tx, admin(real.ctx, { synthetic: true }), real.id, await stamp(real.ctx, real.id)),
      ),
    );
    expect(realError.message).toMatch(/synthetic data only/);
    expect((await detail(real.ctx, real.id)).status).toBe("active");

    const sandbox = await sandboxConnection("active");
    const sandboxError = await refusal(
      withTenant(sandbox.ctx, async (tx) =>
        pauseConnection(tx, admin(sandbox.ctx), sandbox.id, await stamp(sandbox.ctx, sandbox.id)),
      ),
    );
    expect(sandboxError.message).toMatch(/isn't available in production/);
    expect((await detail(sandbox.ctx, sandbox.id)).status).toBe("active");

    // ...and the sandbox pauses where it is allowed.
    await withTenant(sandbox.ctx, async (tx) =>
      pauseConnection(
        tx,
        admin(sandbox.ctx, { synthetic: true }),
        sandbox.id,
        await stamp(sandbox.ctx, sandbox.id),
      ),
    );
    expect((await detail(sandbox.ctx, sandbox.id)).status).toBe("paused");
  });

  it("refuses a revoked connection", async () => {
    const { ctx, id } = await realConnection("active");
    await withTenant(ctx, async (tx) =>
      revokeConnection(tx, admin(ctx), id, (await getConnection(tx, id))!.updatedAt.toISOString(), "other"),
    );
    const error = await refusal(
      withTenant(ctx, async (tx) => pauseConnection(tx, admin(ctx), id, await stamp(ctx, id))),
    );
    expect(error.message).toMatch(/revoked/);
  });
});

describe("resumeConnection (step-up, R-7.2.2)", () => {
  it.each(["paused", "error"] as const)(
    "refuses a %s connection without a recent MFA verification, writing and auditing nothing",
    async (state) => {
      const { ctx, id } = await realConnection(state);
      const before = await auditCount(id);
      const error = await refusal(
        withTenant(ctx, async (tx) =>
          resumeConnection(tx, admin(ctx, { mfa: false }), id, await stamp(ctx, id)),
        ),
      );
      expect(error.stepUpRequired).toBe(true);
      expect(error.message).toMatch(/two-step verification/);
      expect((await detail(ctx, id)).status).toBe(state);
      expect(await auditCount(id)).toBe(before);
    },
  );

  it("resumes a paused connection after a step-up and audits it", async () => {
    const { ctx, id } = await realConnection("paused");
    await withTenant(ctx, async (tx) =>
      resumeConnection(
        tx,
        admin(ctx, { mfa: true }),
        id,
        (await getConnection(tx, id))!.updatedAt.toISOString(),
      ),
    );
    expect((await detail(ctx, id)).status).toBe("active");
    expect(await lastAudit(id)).toMatchObject({
      action: "integration.connection_resumed",
      actorUserId: ctx.userId,
      tenantId: ctx.tenantId,
      metadata: { previous_status: "paused", sandbox: false },
    });
  });

  it("resumes an errored connection after a step-up and clears the reason it errored with", async () => {
    const { ctx, id } = await realConnection("error");
    const before = await systemDb()
      .select({ reason: integrationConnections.statusReason })
      .from(integrationConnections)
      .where(eq(integrationConnections.id, id));
    expect(before[0]!.reason).toBe("auth_failed");
    await withTenant(ctx, async (tx) =>
      resumeConnection(
        tx,
        admin(ctx, { mfa: true }),
        id,
        (await getConnection(tx, id))!.updatedAt.toISOString(),
      ),
    );
    const detailed = await detail(ctx, id);
    expect(detailed.status).toBe("active");
    expect(detailed.statusReason).toBeNull();
    expect(await lastAudit(id)).toMatchObject({ metadata: { previous_status: "error" } });
  });

  it.each(["draft", "pending_approval", "active"] as const)(
    "refuses a %s connection even after a step-up",
    async (state) => {
      const { ctx, id } = await realConnection(state);
      const error = await refusal(
        withTenant(ctx, async (tx) =>
          resumeConnection(tx, admin(ctx, { mfa: true }), id, await stamp(ctx, id)),
        ),
      );
      expect(error.message).toMatch(/isn't in a state where that is possible/);
      expect((await detail(ctx, id)).status).toBe(state);
    },
  );

  it("refuses anyone but an administrator, step-up or not", async () => {
    const { ctx, id } = await realConnection("paused");
    const error = await refusal(
      withTenant(ctx, async (tx) =>
        resumeConnection(tx, { ...admin(ctx, { mfa: true }), role: "manager" }, id, await stamp(ctx, id)),
      ),
    );
    expect(error.message).toMatch(/administrator/);
    expect((await detail(ctx, id)).status).toBe("paused");
  });

  it("is not found across practices, even with a fresh step-up", async () => {
    const { ctx, id } = await realConnection("paused");
    const opened = await stamp(ctx, id);
    const before = await auditCount(id);
    const error = await refusal(
      withTenant(b, (tx) => resumeConnection(tx, admin(b, { mfa: true }), id, opened)),
    );
    expect(error.message).toMatch(/not found/);
    expect(error.stepUpRequired).toBe(false);
    expect((await detail(ctx, id)).status).toBe("paused");
    expect(await auditCount(id)).toBe(before);
  });

  it("applies the environment rule before it would restart a sync", async () => {
    const real = await realConnection("paused");
    const realError = await refusal(
      withTenant(real.ctx, async (tx) =>
        resumeConnection(
          tx,
          admin(real.ctx, { synthetic: true, mfa: true }),
          real.id,
          await stamp(real.ctx, real.id),
        ),
      ),
    );
    expect(realError.message).toMatch(/synthetic data only/);
    expect((await detail(real.ctx, real.id)).status).toBe("paused");

    const sandbox = await sandboxConnection("paused");
    const sandboxError = await refusal(
      withTenant(sandbox.ctx, async (tx) =>
        resumeConnection(
          tx,
          admin(sandbox.ctx, { mfa: true }),
          sandbox.id,
          await stamp(sandbox.ctx, sandbox.id),
        ),
      ),
    );
    expect(sandboxError.message).toMatch(/isn't available in production/);
    expect((await detail(sandbox.ctx, sandbox.id)).status).toBe("paused");
  });

  it("refuses a stale page", async () => {
    const { ctx, id } = await realConnection("paused");
    const opened = await stamp(ctx, id);
    await withTenant(ctx, (tx) =>
      updateConnection(tx, admin(ctx), id, opened, { displayName: "Renamed since the page opened" }),
    );
    const error = await refusal(
      withTenant(ctx, (tx) => resumeConnection(tx, admin(ctx, { mfa: true }), id, opened)),
    );
    expect(error.message).toMatch(/changed since you opened it/);
    expect((await detail(ctx, id)).status).toBe("paused");
  });
});

describe("withdrawConnection", () => {
  const registered = (id: string) =>
    systemDb()
      .select({ id: integrationEndpointRegistry.id })
      .from(integrationEndpointRegistry)
      .where(eq(integrationEndpointRegistry.connectionId, id));

  it("returns a pending connection to draft, releases its registry claim, and audits both", async () => {
    const { ctx, id } = await realConnection("pending_approval");
    expect(await registered(id)).toHaveLength(1);
    await withTenant(ctx, async (tx) =>
      withdrawConnection(tx, admin(ctx), id, (await getConnection(tx, id))!.updatedAt.toISOString()),
    );
    expect((await detail(ctx, id)).status).toBe("draft");
    expect(await registered(id)).toHaveLength(0);
    expect(await lastAudit(id)).toMatchObject({
      action: "integration.connection_updated",
      actorUserId: ctx.userId,
      tenantId: ctx.tenantId,
      metadata: { transition: "withdrawn", previous_status: "pending_approval", registry_released: true },
    });
  });

  it("makes the endpoint editable again, since the connection is a never-synced draft", async () => {
    const { ctx, id } = await realConnection("pending_approval");
    await withTenant(ctx, async (tx) =>
      withdrawConnection(tx, admin(ctx), id, (await getConnection(tx, id))!.updatedAt.toISOString()),
    );
    const corrected = endpoint({ displayName: "Corrected EHR" });
    await withTenant(ctx, async (tx) =>
      updateConnection(tx, admin(ctx), id, (await getConnection(tx, id))!.updatedAt.toISOString(), corrected),
    );
    expect(await detail(ctx, id)).toMatchObject({ status: "draft", displayName: "Corrected EHR" });
  });

  it.each(["draft", "active", "paused"] as const)("refuses a %s connection", async (state) => {
    const { ctx, id } = await realConnection(state);
    const before = await auditCount(id);
    const error = await refusal(
      withTenant(ctx, async (tx) => withdrawConnection(tx, admin(ctx), id, await stamp(ctx, id))),
    );
    expect(error.message).toMatch(/isn't in a state where that is possible/);
    expect((await detail(ctx, id)).status).toBe(state);
    expect(await auditCount(id)).toBe(before);
  });

  it("refuses anyone but an administrator", async () => {
    const { ctx, id } = await realConnection("pending_approval");
    const error = await refusal(
      withTenant(ctx, async (tx) =>
        withdrawConnection(tx, { ...admin(ctx), role: "compliance" }, id, await stamp(ctx, id)),
      ),
    );
    expect(error.message).toMatch(/administrator/);
    expect((await detail(ctx, id)).status).toBe("pending_approval");
    expect(await registered(id)).toHaveLength(1);
  });

  it("is not found across practices and leaves the other practice's claim alone", async () => {
    const { ctx, id } = await realConnection("pending_approval");
    const opened = await stamp(ctx, id);
    const error = await refusal(withTenant(b, (tx) => withdrawConnection(tx, admin(b), id, opened)));
    expect(error.message).toMatch(/not found/);
    expect((await detail(ctx, id)).status).toBe("pending_approval");
    expect(await registered(id)).toHaveLength(1);
  });

  it("applies the environment rule", async () => {
    const { ctx, id } = await realConnection("pending_approval");
    const error = await refusal(
      withTenant(ctx, async (tx) =>
        withdrawConnection(tx, admin(ctx, { synthetic: true }), id, await stamp(ctx, id)),
      ),
    );
    expect(error.message).toMatch(/synthetic data only/);
    expect((await detail(ctx, id)).status).toBe("pending_approval");
    expect(await registered(id)).toHaveLength(1);
  });

  it("refuses a stale page", async () => {
    const { ctx, id } = await realConnection("pending_approval");
    const opened = await stamp(ctx, id);
    await withTenant(ctx, (tx) =>
      updateConnection(tx, admin(ctx), id, opened, { displayName: "Renamed since the page opened" }),
    );
    const error = await refusal(withTenant(ctx, (tx) => withdrawConnection(tx, admin(ctx), id, opened)));
    expect(error.message).toMatch(/changed since you opened it/);
    expect((await detail(ctx, id)).status).toBe("pending_approval");
  });
});

describe("revokeConnection's reason code", () => {
  it.each(REVOKE_REASON_CODES)(
    "records %s as the connection's status reason and as the audit 'why'",
    async (code) => {
      const { ctx, id } = await realConnection("draft");
      await withTenant(ctx, async (tx) =>
        revokeConnection(tx, admin(ctx), id, (await getConnection(tx, id))!.updatedAt.toISOString(), code),
      );
      expect((await detail(ctx, id)).statusReason).toBe(code);
      const event = await lastAudit(id);
      expect(event).toMatchObject({
        action: "integration.connection_revoked",
        reason: code,
        metadata: { reason_code: code, previous_status: "draft" },
      });
    },
  );

  it.each([undefined, null, "", "free text: patient Jane Doe", "NO_LONGER_USED", 3])(
    "refuses %j, writing and auditing nothing",
    async (reason) => {
      const { ctx, id } = await realConnection("active");
      const before = await auditCount(id);
      const error = await refusal(
        withTenant(ctx, async (tx) => revokeConnection(tx, admin(ctx), id, await stamp(ctx, id), reason)),
      );
      expect(error.message).toMatch(/Choose why/);
      expect(error.field).toBe("reason");
      expect((await detail(ctx, id)).status).toBe("active");
      expect(await auditCount(id)).toBe(before);
    },
  );

  it("still revokes without a step-up and outside the environment rule (the emergency stop)", async () => {
    const { ctx, id } = await realConnection("active");
    await withTenant(ctx, async (tx) =>
      revokeConnection(
        tx,
        admin(ctx, { synthetic: true, mfa: false }),
        id,
        (await getConnection(tx, id))!.updatedAt.toISOString(),
        "security_concern",
      ),
    );
    expect(await detail(ctx, id)).toMatchObject({ status: "revoked", statusReason: "security_concern" });
  });
});

describe("registry keys can't be written apart from their URLs (drizzle/0041 CHECKs)", () => {
  const app = (ctx: Ctx, run: ReturnType<typeof sql>) => withTenant(ctx, (tx) => tx.execute(run));

  async function draftWithBase(ctx: Ctx) {
    const { id } = await withTenant(ctx, (tx) => createConnection(tx, admin(ctx), endpoint()));
    return id;
  }

  it("holds for every connection written so far", async () => {
    const violating = await systemDb().execute<{ id: string }>(sql`
      select id from integration_connections
      where endpoint_key <> lower(base_url)
         or (token_endpoint_key is not null
             and (token_endpoint is null or token_endpoint_key <> lower(token_endpoint)))
    `);
    expect(violating.rows).toEqual([]);
  });

  it("accepts a mixed-case base URL with its lowercased key (what url-rules writes)", async () => {
    const { id } = await withTenant(a, (tx) =>
      createConnection(tx, admin(a), endpoint({ baseUrl: "https://mixed-case.example.com/API/FHIR/R4" })),
    );
    const [row] = await systemDb()
      .select({ baseUrl: integrationConnections.baseUrl, key: integrationConnections.endpointKey })
      .from(integrationConnections)
      .where(eq(integrationConnections.id, id));
    expect(row).toEqual({
      baseUrl: "https://mixed-case.example.com/API/FHIR/R4",
      key: "https://mixed-case.example.com/api/fhir/r4",
    });
  });

  it("refuses an insert whose endpoint_key isn't the lowercased base_url", async () => {
    await expectDbError(
      app(
        a,
        sql`insert into integration_connections
          (tenant_id, display_name, base_url, endpoint_key, client_id, mrn_identifier_system, created_by, updated_by)
          values (${a.tenantId}::uuid, 'Skewed key', 'https://one.example.com/r4', 'https://two.example.com/r4',
                  'skew-client', 'https://one.example.com/mrn', ${a.userId}::uuid, ${a.userId}::uuid)`,
      ),
      /integration_connections_endpoint_key_matches_url/,
    );
  });

  it("refuses an insert whose endpoint_key keeps the base_url's capitals", async () => {
    await expectDbError(
      app(
        a,
        sql`insert into integration_connections
          (tenant_id, display_name, base_url, endpoint_key, client_id, mrn_identifier_system, created_by, updated_by)
          values (${a.tenantId}::uuid, 'Capital key', 'https://cap.example.com/R4', 'https://cap.example.com/R4',
                  'cap-client', 'https://cap.example.com/mrn', ${a.userId}::uuid, ${a.userId}::uuid)`,
      ),
      /integration_connections_endpoint_key_matches_url/,
    );
  });

  it("refuses moving endpoint_key or base_url apart on a draft", async () => {
    const id = await draftWithBase(a);
    await expectDbError(
      app(
        a,
        sql`update integration_connections set endpoint_key = 'https://elsewhere.example.com/r4' where id = ${id}::uuid`,
      ),
      /integration_connections_endpoint_key_matches_url/,
    );
    await expectDbError(
      app(
        a,
        sql`update integration_connections set base_url = 'https://elsewhere.example.com/r4' where id = ${id}::uuid`,
      ),
      /integration_connections_endpoint_key_matches_url/,
    );
  });

  it("refuses a token_endpoint_key with no token_endpoint, or one that differs from it", async () => {
    const id = await draftWithBase(a);
    await expectDbError(
      app(
        a,
        sql`update integration_connections set token_endpoint_key = 'https://auth.example.com/token' where id = ${id}::uuid`,
      ),
      /integration_connections_token_endpoint_key_matches_url/,
    );
    await expectDbError(
      app(
        a,
        sql`update integration_connections
            set token_endpoint = 'https://auth.example.com/token',
                token_endpoint_key = 'https://other.example.com/token'
            where id = ${id}::uuid`,
      ),
      /integration_connections_token_endpoint_key_matches_url/,
    );
  });

  it("accepts a token endpoint alone, and with its lowercased key", async () => {
    const id = await draftWithBase(a);
    await app(
      a,
      sql`update integration_connections set token_endpoint = 'https://auth.example.com/Token' where id = ${id}::uuid`,
    );
    await app(
      a,
      sql`update integration_connections set token_endpoint_key = 'https://auth.example.com/token' where id = ${id}::uuid`,
    );
    const [row] = await systemDb()
      .select({
        endpoint: integrationConnections.tokenEndpoint,
        key: integrationConnections.tokenEndpointKey,
      })
      .from(integrationConnections)
      .where(eq(integrationConnections.id, id));
    expect(row).toEqual({
      endpoint: "https://auth.example.com/Token",
      key: "https://auth.example.com/token",
    });
  });
});
