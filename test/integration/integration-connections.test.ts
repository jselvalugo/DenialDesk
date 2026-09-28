import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, integrationConnections, integrationEndpointRegistry } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  createConnection,
  createSandboxConnection,
  getConnection,
  IntegrationConnectionError,
  listConnections,
  revokeConnection,
  updateConnection,
  type IntegrationActor,
} from "@/domain/integrations/connections";
import { SANDBOX_BASE_URL } from "@/integrations/fhir/url-rules";
import { createTestTenant } from "./helpers";

// docs/specs/patient-integrations.md PI1b (domain): create, edit, and revoke EHR/PM connections.
// Configuration only; R-7.2.4 (tenant isolation), R-7.5.1 (audit), ADR 0010.

type Ctx = { tenantId: string; userId: string };
let a: Ctx;
let b: Ctx;
/** Production-shaped actor (real endpoints allowed) unless `syntheticOnly` is passed. */
const admin = (ctx: Ctx, syntheticOnly = false): IntegrationActor => ({
  ...ctx,
  role: "admin",
  syntheticOnly,
});

beforeAll(async () => {
  a = await createTestTenant("Connections A");
  b = await createTestTenant("Connections B");
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

async function lastAudit(entityId: string) {
  const [event] = await systemDb()
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.entityId, entityId))
    .orderBy(desc(auditEvents.id))
    .limit(1);
  return event!;
}

async function detail(ctx: Ctx, id: string) {
  return (await withTenant(ctx, (tx) => getConnection(tx, id)))!;
}

describe("createConnection", () => {
  it("creates a draft with the normalized URL and endpoint key, and audits configuration only", async () => {
    const input = endpoint();
    const { id } = await withTenant(a, (tx) => createConnection(tx, admin(a), input));
    const row = await detail(a, id);
    const host = new URL(input.baseUrl).hostname;
    expect(row).toMatchObject({
      status: "draft",
      isSandbox: false,
      targetTable: "patients",
      displayName: "Main EHR",
      baseUrl: `https://${host}/api/FHIR/R4`,
      clientId: input.clientId,
      hasSynced: false,
    });
    const [stored] = await systemDb()
      .select({
        endpointKey: integrationConnections.endpointKey,
        createdBy: integrationConnections.createdBy,
      })
      .from(integrationConnections)
      .where(eq(integrationConnections.id, id));
    expect(stored).toEqual({ endpointKey: `https://${host}/api/fhir/r4`, createdBy: a.userId });
    const event = await lastAudit(id);
    expect(event).toMatchObject({
      action: "integration.connection_created",
      actorUserId: a.userId,
      tenantId: a.tenantId,
      entityType: "integration_connection",
    });
    expect(event.metadata).toEqual({
      target_table: "patients",
      sandbox: false,
      base_url: `https://${host}/api/FHIR/R4`,
      client_id: input.clientId,
    });
  });

  it("refuses a real endpoint where only synthetic data is allowed", async () => {
    const error = await refusal(withTenant(a, (tx) => createConnection(tx, admin(a, true), endpoint())));
    expect(error.field).toBe("baseUrl");
    expect(error.message).toMatch(/synthetic data only/);
  });

  it("refuses the sandbox URL typed as a real endpoint", async () => {
    const error = await refusal(
      withTenant(a, (tx) => createConnection(tx, admin(a), endpoint({ baseUrl: SANDBOX_BASE_URL }))),
    );
    expect(error.field).toBe("baseUrl");
  });

  it("refuses anyone but an administrator", async () => {
    const error = await refusal(
      withTenant(a, (tx) => createConnection(tx, { ...admin(a), role: "manager" }, endpoint())),
    );
    expect(error.message).toMatch(/administrator/);
  });

  it("refuses a field outside the allow-list instead of dropping it (no ZodError escapes)", async () => {
    for (const extra of [
      { status: "active" },
      { tenantId: b.tenantId },
      { tokenEndpoint: "https://x.example.com/t" },
    ]) {
      const error = await refusal(withTenant(a, (tx) => createConnection(tx, admin(a), endpoint(extra))));
      expect(error).toBeInstanceOf(IntegrationConnectionError);
      expect(error.field).toBeUndefined();
    }
  });

  it.each([
    [{ displayName: "   " }, "displayName"],
    [{ displayName: "x".repeat(81) }, "displayName"],
    [{ displayName: "Bad\u0007name" }, "displayName"],
    [{ baseUrl: "http://fhir.example.com/r4" }, "baseUrl"],
    [{ baseUrl: "https://10.1.2.3/r4" }, "baseUrl"],
    [{ clientId: "" }, "clientId"],
    [{ clientId: "has space" }, "clientId"],
    [{ mrnIdentifierSystem: "http://hl7.org/fhir/sid/us-ssn" }, "mrnIdentifierSystem"],
    [{ mrnIdentifierSystem: "urn:oid:2.16.840.1.113883.4.1" }, "mrnIdentifierSystem"],
  ])("refuses %j on field %s", async (override, field) => {
    const error = await refusal(withTenant(a, (tx) => createConnection(tx, admin(a), endpoint(override))));
    expect(error.field).toBe(field);
  });
});

describe("createSandboxConnection", () => {
  it("creates a sandbox draft with the pinned endpoint where only synthetic data is allowed", async () => {
    const { id } = await withTenant(a, (tx) =>
      createSandboxConnection(tx, admin(a, true), { displayName: "Test sandbox" }),
    );
    expect(await detail(a, id)).toMatchObject({
      status: "draft",
      isSandbox: true,
      baseUrl: SANDBOX_BASE_URL,
      clientId: "sandbox-client",
    });
    expect((await lastAudit(id)).metadata).toEqual({ target_table: "patients", sandbox: true });
  });

  it("is refused in production", async () => {
    const error = await refusal(
      withTenant(a, (tx) => createSandboxConnection(tx, admin(a), { displayName: "Test sandbox" })),
    );
    expect(error.message).toMatch(/production/);
  });

  it("takes only a name from the client", async () => {
    const error = await refusal(
      withTenant(a, (tx) =>
        createSandboxConnection(tx, admin(a, true), {
          displayName: "x",
          baseUrl: "https://evil.example.com",
        }),
      ),
    );
    expect(error.field).toBeUndefined();
  });
});

describe("updateConnection", () => {
  it("edits a draft's endpoint, audits the changed field names with old and new configuration", async () => {
    const before = endpoint();
    const { id } = await withTenant(a, (tx) => createConnection(tx, admin(a), before));
    const stamp = (await detail(a, id)).updatedAt.toISOString();
    const after = endpoint({ displayName: "Renamed EHR" });
    await withTenant(a, (tx) => updateConnection(tx, admin(a), id, stamp, after));
    const row = await detail(a, id);
    expect(row.displayName).toBe("Renamed EHR");
    expect(row.clientId).toBe(after.clientId);
    const event = await lastAudit(id);
    expect(event.action).toBe("integration.connection_updated");
    expect(String(event.metadata!.fields).split(",").sort()).toEqual(
      ["baseUrl", "clientId", "displayName", "mrnIdentifierSystem"].sort(),
    );
    expect(event.metadata).toMatchObject({
      old_client_id: before.clientId,
      client_id: after.clientId,
      base_url: row.baseUrl,
    });
  });

  it("refuses a stale edit", async () => {
    const { id } = await withTenant(a, (tx) => createConnection(tx, admin(a), endpoint()));
    const stamp = (await detail(a, id)).updatedAt.toISOString();
    await withTenant(a, (tx) =>
      updateConnection(tx, admin(a), id, stamp, endpoint({ displayName: "First" })),
    );
    const error = await refusal(
      withTenant(a, (tx) => updateConnection(tx, admin(a), id, stamp, endpoint({ displayName: "Second" }))),
    );
    expect(error.message).toMatch(/changed since you opened it/);
  });

  it("locks the endpoint once the connection has synced, but still allows a rename", async () => {
    const input = endpoint();
    const { id } = await withTenant(a, (tx) => createConnection(tx, admin(a), input));
    // Only a sync sets has_synced; stand in for the first committed page as the table owner.
    await systemDb().execute(
      sql`update integration_connections set has_synced = true where id = ${id}::uuid`,
    );
    let stamp = (await detail(a, id)).updatedAt.toISOString();
    const error = await refusal(
      withTenant(a, (tx) =>
        updateConnection(tx, admin(a), id, stamp, { ...input, clientId: "other-client" }),
      ),
    );
    expect(error.field).toBe("baseUrl");
    await withTenant(a, (tx) =>
      updateConnection(tx, admin(a), id, stamp, { ...input, displayName: "Kept EHR" }),
    );
    expect((await detail(a, id)).displayName).toBe("Kept EHR");
    expect((await lastAudit(id)).metadata).toEqual({ fields: "displayName" });
    stamp = (await detail(a, id)).updatedAt.toISOString();
    // Resending the unchanged endpoint with the new name is a no-op, not an error.
    await withTenant(a, (tx) =>
      updateConnection(tx, admin(a), id, stamp, { ...input, displayName: "Kept EHR" }),
    );
  });

  it("renames a sandbox connection; its endpoint can't be sent at all", async () => {
    const { id } = await withTenant(a, (tx) =>
      createSandboxConnection(tx, admin(a, true), { displayName: "Sandbox" }),
    );
    const stamp = (await detail(a, id)).updatedAt.toISOString();
    const error = await refusal(
      withTenant(a, (tx) => updateConnection(tx, admin(a, true), id, stamp, endpoint({ displayName: "x" }))),
    );
    expect(error.field).toBeUndefined();
    await withTenant(a, (tx) =>
      updateConnection(tx, admin(a, true), id, stamp, { displayName: "Sandbox 2" }),
    );
    expect((await detail(a, id)).displayName).toBe("Sandbox 2");
  });

  it("can't see or edit another practice's connection", async () => {
    const { id } = await withTenant(b, (tx) => createConnection(tx, admin(b), endpoint()));
    expect(await withTenant(a, (tx) => getConnection(tx, id))).toBeNull();
    expect((await withTenant(a, (tx) => listConnections(tx))).map((r) => r.id)).not.toContain(id);
    const error = await refusal(
      withTenant(a, (tx) => updateConnection(tx, admin(a), id, new Date().toISOString(), endpoint())),
    );
    expect(error.message).toMatch(/not found/);
  });
});

describe("revokeConnection", () => {
  it("revokes a draft, records who and when, audits the previous status, and is terminal", async () => {
    const input = endpoint();
    const { id } = await withTenant(a, (tx) => createConnection(tx, admin(a), input));
    const stamp = (await detail(a, id)).updatedAt.toISOString();
    await withTenant(a, (tx) => revokeConnection(tx, admin(a), id, stamp));
    const row = await detail(a, id);
    expect(row.status).toBe("revoked");
    expect(row.revokedAt).not.toBeNull();
    const [stored] = await systemDb()
      .select({ revokedBy: integrationConnections.revokedBy })
      .from(integrationConnections)
      .where(eq(integrationConnections.id, id));
    expect(stored!.revokedBy).toBe(a.userId);
    expect(await lastAudit(id)).toMatchObject({
      action: "integration.connection_revoked",
      metadata: { previous_status: "draft", sandbox: false },
    });
    const next = row.updatedAt.toISOString();
    expect(
      (await refusal(withTenant(a, (tx) => updateConnection(tx, admin(a), id, next, input)))).message,
    ).toMatch(/revoked/);
    expect((await refusal(withTenant(a, (tx) => revokeConnection(tx, admin(a), id, next)))).message).toMatch(
      /revoked/,
    );
  });

  it("releases the connection's registry claim when a submitted connection is revoked", async () => {
    const { id } = await withTenant(a, (tx) => createConnection(tx, admin(a), endpoint()));
    const tokenKey = `https://auth-${randomUUID().slice(0, 8)}.example.com/token`;
    // Stand in for PI2a discovery and Submit, then claim the registry as Submit will (PI1c).
    await withTenant(a, async (tx) => {
      await tx.execute(sql`
        update integration_connections
        set token_endpoint = ${tokenKey}, token_endpoint_key = ${tokenKey}
        where id = ${id}::uuid
      `);
      await tx.execute(sql`
        update integration_connections
        set status = 'pending_approval', submitted_by = ${a.userId}::uuid, submitted_at = now(),
            us_residency_attested_by = ${a.userId}::uuid, us_residency_attested_at = now()
        where id = ${id}::uuid
      `);
      await tx.execute(sql`select integration_registry_claim(${id}::uuid)`);
    });
    const claimed = () =>
      systemDb()
        .select({ id: integrationEndpointRegistry.id })
        .from(integrationEndpointRegistry)
        .where(and(eq(integrationEndpointRegistry.connectionId, id)));
    expect(await claimed()).toHaveLength(1);
    const stamp = (await detail(a, id)).updatedAt.toISOString();
    await withTenant(a, (tx) => revokeConnection(tx, admin(a), id, stamp));
    expect(await claimed()).toHaveLength(0);
    expect((await lastAudit(id)).metadata).toMatchObject({ previous_status: "pending_approval" });
  });

  it("refuses anyone but an administrator", async () => {
    const { id } = await withTenant(a, (tx) => createConnection(tx, admin(a), endpoint()));
    const stamp = (await detail(a, id)).updatedAt.toISOString();
    const error = await refusal(
      withTenant(a, (tx) => revokeConnection(tx, { ...admin(a), role: "specialist" }, id, stamp)),
    );
    expect(error.message).toMatch(/administrator/);
    expect((await detail(a, id)).status).toBe("draft");
  });
});
