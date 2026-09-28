import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq, sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, integrationConnections, integrationEndpointRegistry } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  connectionSummary,
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

/** Stand-in for PI2a's Submit (draft → pending_approval), as the practice's app role. */
async function submitStandIn(ctx: Ctx, id: string) {
  await withTenant(ctx, (tx) =>
    tx.execute(sql`
      update integration_connections
      set status = 'pending_approval', submitted_by = ${ctx.userId}::uuid, submitted_at = now(),
          us_residency_attested_by = ${ctx.userId}::uuid, us_residency_attested_at = now()
      where id = ${id}::uuid
    `),
  );
}

async function auditCount(entityId: string) {
  const rows = await systemDb()
    .select({ id: auditEvents.id })
    .from(auditEvents)
    .where(eq(auditEvents.entityId, entityId));
  return rows.length;
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
      mrn_identifier_system: input.mrnIdentifierSystem,
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

  it("refuses any URL on the sandbox host, and the sandbox's MRN system, for a real connection", async () => {
    for (const override of [
      { baseUrl: "https://sandbox.fhir.denialdesk.invalid/other" },
      { baseUrl: `${SANDBOX_BASE_URL}/x` },
      { mrnIdentifierSystem: "https://sandbox.fhir.denialdesk.invalid/mrn" },
      { mrnIdentifierSystem: "HTTPS://SANDBOX.fhir.denialdesk.invalid/mrn/" },
      { mrnIdentifierSystem: "http://sandbox.fhir.denialdesk.invalid/other" },
    ]) {
      const error = await refusal(withTenant(a, (tx) => createConnection(tx, admin(a), endpoint(override))));
      expect(error.field).toBe(Object.keys(override)[0]);
    }
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
    [{ displayName: "EHR\u202egnp.exe" }, "displayName"],
    [{ baseUrl: "https://fhir.example.com/%72%34" }, "baseUrl"],
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

describe("missing or mistyped fields", () => {
  it.each([
    ["displayName", /Enter a name/],
    ["baseUrl", /Enter the FHIR base URL/],
    ["clientId", /Enter the client ID/],
    ["mrnIdentifierSystem", /Enter the identifier system/],
  ])("reports a missing %s as required, not too long", async (field, message) => {
    for (const value of [undefined, null, 5]) {
      const input: Record<string, unknown> = endpoint();
      if (value === undefined) delete input[field];
      else input[field] = value;
      const error = await refusal(withTenant(a, (tx) => createConnection(tx, admin(a), input)));
      expect(error.field).toBe(field);
      expect(error.message).toMatch(message);
    }
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
      old_mrn_identifier_system: before.mrnIdentifierSystem,
      mrn_identifier_system: after.mrnIdentifierSystem,
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
    expect(error.field).toBe("clientId");
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

  it("locks the endpoint while awaiting approval (status, not only has_synced), but still allows a rename", async () => {
    const c = await createTestTenant("Connections live");
    const input = endpoint();
    const { id } = await withTenant(c, (tx) => createConnection(tx, admin(c), input));
    await submitStandIn(c, id);
    const stamp = (await detail(c, id)).updatedAt.toISOString();
    for (const [field, value] of [
      ["baseUrl", "https://other-ehr.example.com/r4"],
      ["clientId", "other-client"],
      ["mrnIdentifierSystem", "https://other-ehr.example.com/mrn"],
    ] as const) {
      const error = await refusal(
        withTenant(c, (tx) => updateConnection(tx, admin(c), id, stamp, { ...input, [field]: value })),
      );
      expect(error.field).toBe(field);
      expect(error.message).toMatch(/only change while the connection is a draft/);
    }
    // The page omits disabled (locked) inputs: a name-only form renames.
    await withTenant(c, (tx) => updateConnection(tx, admin(c), id, stamp, { displayName: "Awaiting EHR" }));
    expect(await detail(c, id)).toMatchObject({ displayName: "Awaiting EHR", status: "pending_approval" });
  });

  it("renames a locked connection without re-validating its stored endpoint against today's rules", async () => {
    const c = await createTestTenant("Connections live");
    const input = endpoint();
    const { id } = await withTenant(c, (tx) => createConnection(tx, admin(c), input));
    await submitStandIn(c, id);
    // The stored endpoint now fails today's rules (here: this environment only allows synthetic
    // data); a rename must still work, since the administrator can't change the endpoint anyway.
    const stamp = (await detail(c, id)).updatedAt.toISOString();
    await withTenant(c, (tx) =>
      updateConnection(tx, admin(c, true), id, stamp, { ...input, displayName: "Still renamable" }),
    );
    expect((await detail(c, id)).displayName).toBe("Still renamable");
  });

  it("applies the environment rule when a draft's endpoint is edited", async () => {
    const { id } = await withTenant(a, (tx) => createConnection(tx, admin(a), endpoint()));
    const stamp = (await detail(a, id)).updatedAt.toISOString();
    const error = await refusal(
      withTenant(a, (tx) => updateConnection(tx, admin(a, true), id, stamp, endpoint())),
    );
    expect(error.message).toMatch(/synthetic data only/);
  });

  it("writes nothing and audits nothing when nothing changed", async () => {
    const input = endpoint();
    const { id } = await withTenant(a, (tx) => createConnection(tx, admin(a), input));
    const before = await detail(a, id);
    const events = await auditCount(id);
    // Same values in another spelling (host case, trailing slash) are the same values.
    const respelled = { ...input, baseUrl: input.baseUrl.replace("https://ehr-", "https://EHR-") + "/" };
    await withTenant(a, (tx) =>
      updateConnection(tx, admin(a), id, before.updatedAt.toISOString(), respelled),
    );
    expect((await detail(a, id)).updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    expect(await auditCount(id)).toBe(events);
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
      metadata: { previous_status: "draft", sandbox: false, registry_released: false },
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
    const c = await createTestTenant("Connections live");
    const { id } = await withTenant(c, (tx) => createConnection(tx, admin(c), endpoint()));
    const tokenKey = `https://auth-${randomUUID().slice(0, 8)}.example.com/token`;
    // Stand in for PI2a discovery and Submit, then claim the registry as Submit will (PI1c).
    await withTenant(c, async (tx) => {
      await tx.execute(sql`
        update integration_connections
        set token_endpoint = ${tokenKey}, token_endpoint_key = ${tokenKey}
        where id = ${id}::uuid
      `);
      await tx.execute(sql`
        update integration_connections
        set status = 'pending_approval', submitted_by = ${c.userId}::uuid, submitted_at = now(),
            us_residency_attested_by = ${c.userId}::uuid, us_residency_attested_at = now()
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
    const stamp = (await detail(c, id)).updatedAt.toISOString();
    await withTenant(c, (tx) => revokeConnection(tx, admin(c), id, stamp));
    expect(await claimed()).toHaveLength(0);
    expect((await lastAudit(id)).metadata).toMatchObject({
      previous_status: "pending_approval",
      registry_released: true,
    });
  });

  it("revokes a live (active) connection and records the endpoint it pointed at", async () => {
    const c = await createTestTenant("Connections live");
    const { id } = await withTenant(c, (tx) =>
      createSandboxConnection(tx, admin(c, true), { displayName: "Live sandbox" }),
    );
    // Stand-in for sandbox Submit (PI2b): the lifecycle trigger allows a sandbox draft → active.
    await withTenant(c, (tx) =>
      tx.execute(sql`update integration_connections set status = 'active' where id = ${id}::uuid`),
    );
    const stamp = (await detail(c, id)).updatedAt.toISOString();
    await withTenant(c, (tx) => revokeConnection(tx, admin(c, true), id, stamp));
    expect((await detail(c, id)).status).toBe("revoked");
    expect((await lastAudit(id)).metadata).toEqual({
      previous_status: "active",
      sandbox: true,
      registry_released: false,
    });
    const real = endpoint();
    const { id: realId } = await withTenant(c, (tx) => createConnection(tx, admin(c), real));
    const realStamp = (await detail(c, realId)).updatedAt.toISOString();
    await withTenant(c, (tx) => revokeConnection(tx, admin(c), realId, realStamp));
    expect((await lastAudit(realId)).metadata).toMatchObject({
      base_url: (await detail(c, realId)).baseUrl,
      client_id: real.clientId,
      mrn_identifier_system: real.mrnIdentifierSystem,
    });
  });

  it("refuses a stale revoke", async () => {
    const { id } = await withTenant(a, (tx) => createConnection(tx, admin(a), endpoint()));
    const stamp = (await detail(a, id)).updatedAt.toISOString();
    await withTenant(a, (tx) =>
      updateConnection(tx, admin(a), id, stamp, endpoint({ displayName: "Changed" })),
    );
    const error = await refusal(withTenant(a, (tx) => revokeConnection(tx, admin(a), id, stamp)));
    expect(error.message).toMatch(/changed since you opened it/);
    expect((await detail(a, id)).status).toBe("draft");
  });

  it("can't revoke another practice's connection", async () => {
    const { id } = await withTenant(b, (tx) => createConnection(tx, admin(b), endpoint()));
    const stamp = (await detail(b, id)).updatedAt.toISOString();
    const error = await refusal(withTenant(a, (tx) => revokeConnection(tx, admin(a), id, stamp)));
    expect(error.message).toMatch(/not found/);
    expect((await detail(b, id)).status).toBe("draft");
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

/** Stand-in for sandbox Submit (PI2b): draft → active, stamped as submitted like the real one. */
function activateSandboxStandIn(tx: Parameters<Parameters<typeof withTenant>[1]>[0], ctx: Ctx, id: string) {
  return tx.execute(sql`
    update integration_connections
    set status = 'active', submitted_by = ${ctx.userId}::uuid, submitted_at = now()
    where id = ${id}::uuid
  `);
}

describe("connectionSummary (the tab-bar drop-down)", () => {
  it("is manual until a connection is a source, then follows its state and latest run", async () => {
    const c = await createTestTenant("Connections summary");
    const summaryOf = () => withTenant(c, (tx) => connectionSummary(tx, "patients"));
    expect(await summaryOf()).toBeNull();

    // A draft is not a source, and neither is a draft revoked before it was ever submitted.
    const { id: draftId } = await withTenant(c, (tx) =>
      createSandboxConnection(tx, admin(c, true), { displayName: "Never used" }),
    );
    expect(await summaryOf()).toBeNull();
    await withTenant(c, async (tx) =>
      revokeConnection(
        tx,
        admin(c, true),
        draftId,
        (await getConnection(tx, draftId))!.updatedAt.toISOString(),
      ),
    );
    expect(await summaryOf()).toBeNull();

    // Live (sandbox draft → active, as sandbox Submit will do in PI2b), then a queued run.
    const { id } = await withTenant(c, (tx) =>
      createSandboxConnection(tx, admin(c, true), { displayName: "Live sandbox" }),
    );
    await withTenant(c, (tx) => activateSandboxStandIn(tx, c, id));
    expect(await summaryOf()).toEqual({
      connectionId: id,
      displayName: "Live sandbox",
      status: "active",
      lastSuccessAt: null,
      lastRunStatus: null,
    });
    await withTenant(c, (tx) =>
      tx.execute(sql`
        insert into integration_sync_runs (tenant_id, connection_id, trigger, triggered_by)
        values (${c.tenantId}::uuid, ${id}::uuid, 'manual', ${c.userId}::uuid)
      `),
    );
    expect((await summaryOf())!.lastRunStatus).toBe("queued");

    // Revoked after being live: still shown (synced patients came from it), until another is live.
    await withTenant(c, async (tx) =>
      revokeConnection(tx, admin(c, true), id, (await getConnection(tx, id))!.updatedAt.toISOString()),
    );
    expect(await summaryOf()).toMatchObject({
      connectionId: id,
      status: "revoked",
      lastRunStatus: "abandoned",
    });
    const { id: nextId } = await withTenant(c, (tx) =>
      createSandboxConnection(tx, admin(c, true), { displayName: "Next sandbox" }),
    );
    await withTenant(c, (tx) => activateSandboxStandIn(tx, c, nextId));
    expect(await summaryOf()).toMatchObject({ connectionId: nextId, status: "active" });
  });

  it("never shows another practice's connection", async () => {
    const c = await createTestTenant("Connections summary isolation");
    const { id } = await withTenant(b, (tx) =>
      createSandboxConnection(tx, admin(b, true), { displayName: "Practice B live" }),
    );
    await withTenant(b, (tx) => activateSandboxStandIn(tx, b, id));
    expect(await withTenant(c, (tx) => connectionSummary(tx, "patients"))).toBeNull();
    // Leave practice B with no live connection for the other tests in this file.
    await withTenant(b, async (tx) =>
      revokeConnection(tx, admin(b, true), id, (await getConnection(tx, id))!.updatedAt.toISOString()),
    );
  });
});
