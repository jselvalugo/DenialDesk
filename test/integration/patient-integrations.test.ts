import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import {
  integrationEndpointRegistry,
  integrationPayerMappings,
  integrationSyncIssues,
  patients,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { createPatient, updatePatient, updatePatientSensitivityTags } from "@/domain/patients/queries";
import { patientSchema } from "@/domain/patients/record";
import { createTestTenant, expectDbError } from "./helpers";

// docs/specs/patient-integrations.md "PI1a": provenance, connections, the endpoint registry, and
// read-only synced patients. R-7.2.4 (tenant isolation), R-7.5.1 (audit), ADR 0010.
//
// integration_connections and integration_sync_runs grant INSERT/UPDATE on specific columns only
// (approval fields stay out of the app role's reach). Drizzle's query builder always names every
// column of the table (unset ones as DEFAULT), and PostgreSQL requires the privilege on every
// named column even when its value is DEFAULT — so, like `requestUniversityAccess`
// (src/domain/university/access.ts), every write to these two tables below uses raw SQL with an
// explicit, granted column list instead of `.insert()`/`.update()`.

type Ctx = { tenantId: string; userId: string };
let a: Ctx;
let b: Ctx;
const schema = patientSchema({ today: "2026-09-28", syntheticOnly: true });
const actor = (ctx: Ctx) => ({ ...ctx, canTag: true, syntheticOnly: true });
function patientInput(overrides: Record<string, unknown> = {}) {
  return schema.parse({
    mrn: "",
    firstName: "Quinn",
    lastName: "Zephyrine",
    birthDate: "1990-06-15",
    sex: "U",
    addressLine1: "",
    city: "",
    state: "",
    postalCode: "",
    phone: "",
    primaryPayerId: "",
    memberId: "",
    sensitivityTags: [],
    ...overrides,
  });
}

beforeAll(async () => {
  a = await createTestTenant("Integrations A");
  b = await createTestTenant("Integrations B");
});

afterAll(() => closeDatabase());

let seq = 0;
/** Inserts one connection as the practice (denialdesk_app), returning its id. */
async function makeConnection(
  ctx: Ctx,
  overrides: {
    tenantId?: string;
    baseUrl?: string;
    endpointKey?: string;
    clientId?: string;
    isSandbox?: boolean;
  } = {},
): Promise<string> {
  seq += 1;
  const host = `ehr${seq}-${randomUUID().slice(0, 8)}.example.test`;
  const tenantId = overrides.tenantId ?? ctx.tenantId;
  const baseUrl = overrides.baseUrl ?? `https://${host}/r4`;
  const endpointKey = overrides.endpointKey ?? baseUrl;
  const clientId = overrides.clientId ?? `client-${seq}`;
  const mrnIdentifierSystem = `https://${host}/mrn`;
  const isSandbox = overrides.isSandbox ?? false;
  const result = await withTenant(ctx, (tx) =>
    tx.execute<{ id: string }>(sql`
      insert into integration_connections
        (tenant_id, display_name, base_url, endpoint_key, client_id, mrn_identifier_system, is_sandbox, created_by, updated_by)
      values (${tenantId}::uuid, 'Test EHR', ${baseUrl}, ${endpointKey}, ${clientId}, ${mrnIdentifierSystem}, ${isSandbox}, ${ctx.userId}::uuid, ${ctx.userId}::uuid)
      returning id
    `),
  );
  return result.rows[0]!.id;
}

async function connectionStatus(id: string): Promise<string> {
  const result = await systemDb().execute<{ status: string }>(
    sql`select status from integration_connections where id = ${id}::uuid`,
  );
  return result.rows[0]!.status;
}

async function submitForApproval(ctx: Ctx, id: string) {
  await withTenant(ctx, (tx) =>
    tx.execute(sql`
      update integration_connections set status = 'pending_approval', submitted_by = ${ctx.userId}::uuid, submitted_at = now()
      where id = ${id}::uuid
    `),
  );
}

/** Only the operator does this in real life (withTenantAsPlatform, table-owner privileges). */
async function approveAsOperator(id: string, operatorUserId: string) {
  await systemDb().execute(sql`
    update integration_connections
    set status = 'active', approved_by = ${operatorUserId}::uuid, approved_at = now(), approval_method = 'phone_verified'
    where id = ${id}::uuid
  `);
}

async function activateAsApp(ctx: Ctx, id: string) {
  return withTenant(ctx, (tx) =>
    tx.execute(sql`update integration_connections set status = 'active' where id = ${id}::uuid`),
  );
}

async function revokeConnection(ctx: Ctx, id: string) {
  await withTenant(ctx, (tx) =>
    tx.execute(sql`
      update integration_connections set status = 'revoked', revoked_by = ${ctx.userId}::uuid, revoked_at = now()
      where id = ${id}::uuid
    `),
  );
}

async function renameConnection(ctx: Ctx, id: string, name: string) {
  return withTenant(ctx, (tx) =>
    tx.execute(sql`update integration_connections set display_name = ${name} where id = ${id}::uuid`),
  );
}

/** Queues and starts a sync run for `connectionId`, returning its id. */
async function makeRunningRun(ctx: Ctx, connectionId: string): Promise<string> {
  const inserted = await withTenant(ctx, (tx) =>
    tx.execute<{ id: string }>(sql`
      insert into integration_sync_runs (tenant_id, connection_id, trigger, triggered_by)
      values (${ctx.tenantId}::uuid, ${connectionId}::uuid, 'manual', ${ctx.userId}::uuid)
      returning id
    `),
  );
  const runId = inserted.rows[0]!.id;
  await withTenant(ctx, (tx) =>
    tx.execute(
      sql`update integration_sync_runs set status = 'running', started_at = now() where id = ${runId}::uuid`,
    ),
  );
  return runId;
}

async function finishRun(ctx: Ctx, runId: string) {
  await withTenant(ctx, (tx) =>
    tx.execute(
      sql`update integration_sync_runs set status = 'succeeded', finished_at = now() where id = ${runId}::uuid`,
    ),
  );
}

async function touchRunHeartbeat(ctx: Ctx, runId: string) {
  return withTenant(ctx, (tx) =>
    tx.execute(sql`update integration_sync_runs set heartbeat_at = now() where id = ${runId}::uuid`),
  );
}

/** Inserts a `fhir` patient row the way a sync run would: with the run's settings in place. */
async function insertSyncedPatient(
  ctx: Ctx,
  connectionId: string,
  runId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const [row] = await withTenant(ctx, async (tx) => {
    await tx.execute(sql`select set_config('app.sync_run_id', ${runId}, true)`);
    await tx.execute(sql`select set_config('app.sync_connection_id', ${connectionId}, true)`);
    return tx
      .insert(patients)
      .values({
        tenantId: ctx.tenantId,
        mrn: `SYN-FHIR-${randomUUID().slice(0, 8)}`,
        firstName: "Fhira",
        lastName: "Testpatient",
        birthDate: "1990-01-01",
        source: "fhir",
        sourceConnectionId: connectionId,
        externalId: `ext-${randomUUID().slice(0, 8)}`,
        ...overrides,
      })
      .returning({ id: patients.id });
  });
  return row!.id;
}

async function claimRegistry(ctx: Ctx, connectionId: string): Promise<boolean> {
  const result = await withTenant(ctx, (tx) =>
    tx.execute<{ claimed: boolean }>(
      sql`select integration_registry_claim(${connectionId}::uuid) as claimed`,
    ),
  );
  return result.rows[0]!.claimed;
}

async function releaseRegistry(ctx: Ctx, connectionId: string): Promise<boolean> {
  const result = await withTenant(ctx, (tx) =>
    tx.execute<{ claimed: boolean }>(
      sql`select integration_registry_release(${connectionId}::uuid) as claimed`,
    ),
  );
  return result.rows[0]!.claimed;
}

describe("tenant isolation", () => {
  it("integration_connections: hides another practice's row and refuses cross-tenant insert/update", async () => {
    const id = await makeConnection(a);
    const seenByB = await withTenant(b, (tx) =>
      tx.execute<{ id: string }>(sql`select id from integration_connections where id = ${id}::uuid`),
    );
    expect(seenByB.rows).toHaveLength(0);
    await expectDbError(
      withTenant(a, (tx) =>
        tx.execute(sql`insert into integration_connections
        (tenant_id, display_name, base_url, endpoint_key, client_id, mrn_identifier_system, created_by, updated_by)
        values (${b.tenantId}::uuid, 'Sneaky', 'https://sneaky.example.test/r4', 'https://sneaky.example.test/r4', 'c', 'https://sneaky.example.test/mrn', ${a.userId}::uuid, ${a.userId}::uuid)`),
      ),
      /row-level security/,
    );
    const updated = await withTenant(b, (tx) =>
      tx.execute<{ id: string }>(
        sql`update integration_connections set display_name = 'Hijacked' where id = ${id}::uuid returning id`,
      ),
    );
    expect(updated.rows).toHaveLength(0);
  });

  it("integration_sync_runs: hides another practice's row and refuses cross-tenant insert/update", async () => {
    const connId = await makeConnection(a);
    const runId = await makeRunningRun(a, connId);
    const seenByB = await withTenant(b, (tx) =>
      tx.execute<{ id: string }>(sql`select id from integration_sync_runs where id = ${runId}::uuid`),
    );
    expect(seenByB.rows).toHaveLength(0);
    await expectDbError(
      withTenant(a, (tx) =>
        tx.execute(
          sql`insert into integration_sync_runs (tenant_id, connection_id, trigger) values (${b.tenantId}::uuid, ${connId}::uuid, 'manual')`,
        ),
      ),
      /row-level security/,
    );
    const updated = await withTenant(b, (tx) =>
      tx.execute<{ id: string }>(
        sql`update integration_sync_runs set heartbeat_at = now() where id = ${runId}::uuid returning id`,
      ),
    );
    expect(updated.rows).toHaveLength(0);
  });

  it("integration_sync_issues: hides another practice's row and refuses cross-tenant insert/update", async () => {
    const connId = await makeConnection(a);
    const runId = await makeRunningRun(a, connId);
    const [issue] = await withTenant(a, (tx) =>
      tx
        .insert(integrationSyncIssues)
        .values({ tenantId: a.tenantId, runId, code: "mrn_missing" })
        .returning({ id: integrationSyncIssues.id }),
    );
    const seenByB = await withTenant(b, (tx) =>
      tx
        .select({ id: integrationSyncIssues.id })
        .from(integrationSyncIssues)
        .where(eq(integrationSyncIssues.id, issue!.id)),
    );
    expect(seenByB).toHaveLength(0);
    await expectDbError(
      withTenant(a, (tx) =>
        tx.insert(integrationSyncIssues).values({ tenantId: b.tenantId, runId, code: "mrn_missing" }),
      ),
      /row-level security/,
    );
    // No UPDATE grant at all (append-only): this is a privilege refusal, not a tenant one.
    await expectDbError(
      withTenant(b, (tx) =>
        tx.update(integrationSyncIssues).set({ code: "x" }).where(eq(integrationSyncIssues.id, issue!.id)),
      ),
      /permission denied/,
    );
  });

  it("integration_payer_mappings: hides another practice's row and refuses cross-tenant insert/update", async () => {
    const connId = await makeConnection(a);
    const [mapping] = await withTenant(a, (tx) =>
      tx
        .insert(integrationPayerMappings)
        .values({
          tenantId: a.tenantId,
          connectionId: connId,
          payorKey: "Organization/1",
          updatedBy: a.userId,
        })
        .returning({ id: integrationPayerMappings.id }),
    );
    const seenByB = await withTenant(b, (tx) =>
      tx
        .select({ id: integrationPayerMappings.id })
        .from(integrationPayerMappings)
        .where(eq(integrationPayerMappings.id, mapping!.id)),
    );
    expect(seenByB).toHaveLength(0);
    await expectDbError(
      withTenant(a, (tx) =>
        tx.insert(integrationPayerMappings).values({
          tenantId: b.tenantId,
          connectionId: connId,
          payorKey: "Organization/2",
          updatedBy: a.userId,
        }),
      ),
      /row-level security/,
    );
    const updated = await withTenant(b, (tx) =>
      tx
        .update(integrationPayerMappings)
        .set({ payorName: "Hijacked" })
        .where(eq(integrationPayerMappings.id, mapping!.id))
        .returning({ id: integrationPayerMappings.id }),
    );
    expect(updated).toHaveLength(0);
  });
});

describe("no DELETE grant on any new table", () => {
  it("integration_connections", async () => {
    await expectDbError(
      withTenant(a, (tx) => tx.execute(sql`delete from integration_connections`)),
      /permission denied/,
    );
  });
  it("integration_sync_runs", async () => {
    await expectDbError(
      withTenant(a, (tx) => tx.execute(sql`delete from integration_sync_runs`)),
      /permission denied/,
    );
  });
  it("integration_sync_issues", async () => {
    await expectDbError(
      withTenant(a, (tx) => tx.delete(integrationSyncIssues)),
      /permission denied/,
    );
  });
  it("integration_payer_mappings", async () => {
    await expectDbError(
      withTenant(a, (tx) => tx.delete(integrationPayerMappings)),
      /permission denied/,
    );
  });
});

describe("integration_connections lifecycle and editability trigger", () => {
  // At most one connection per (tenant, target_table) outside draft/revoked
  // (integration_connections_one_active), so a test that actually activates or submits one uses
  // its own fresh tenant rather than the shared `a`/`b`.
  it("draft -> pending_approval is allowed, but only the operator may activate it", async () => {
    const ctx = await createTestTenant("Lifecycle activate");
    const id = await makeConnection(ctx);
    await submitForApproval(ctx, id);
    await expectDbError(
      activateAsApp(ctx, id),
      /only the platform operator may activate a pending connection/,
    );
    await approveAsOperator(id, ctx.userId);
    expect(await connectionStatus(id)).toBe("active");
  });

  it("refuses an invalid transition (draft -> active for a real connection)", async () => {
    const id = await makeConnection(a);
    await expectDbError(activateAsApp(a, id), /draft -> active is not allowed/);
  });

  it("allows draft -> active directly for a sandbox connection", async () => {
    const ctx = await createTestTenant("Lifecycle sandbox");
    const id = await makeConnection(ctx, { isSandbox: true });
    await activateAsApp(ctx, id);
    expect(await connectionStatus(id)).toBe("active");
  });

  it("the app role cannot write approval columns (column grants)", async () => {
    const id = await makeConnection(a);
    await expectDbError(
      withTenant(a, (tx) =>
        tx.execute(
          sql`update integration_connections set approved_by = ${a.userId}::uuid where id = ${id}::uuid`,
        ),
      ),
      /permission denied/,
    );
    await expectDbError(
      withTenant(a, (tx) =>
        tx.execute(
          sql`update integration_connections set approval_method = 'phone_verified' where id = ${id}::uuid`,
        ),
      ),
      /permission denied/,
    );
  });

  it("revoked is terminal", async () => {
    const id = await makeConnection(a);
    await revokeConnection(a, id);
    await expectDbError(renameConnection(a, id, "New name"), /revoked is terminal/);
  });

  it("locks the endpoint fields once has_synced is set", async () => {
    const id = await makeConnection(a);
    await systemDb().execute(
      sql`update integration_connections set has_synced = true where id = ${id}::uuid`,
    );
    await expectDbError(
      withTenant(a, (tx) =>
        tx.execute(
          sql`update integration_connections set base_url = 'https://elsewhere.example.test/r4' where id = ${id}::uuid`,
        ),
      ),
      /endpoint fields are immutable once synced/,
    );
    // Unrelated fields (e.g. the display name) still change freely.
    await renameConnection(a, id, "Renamed");
  });

  it("while pending approval, only the display name may change", async () => {
    const ctx = await createTestTenant("Lifecycle pending edits");
    const id = await makeConnection(ctx);
    await submitForApproval(ctx, id);
    await expectDbError(
      withTenant(ctx, (tx) =>
        tx.execute(
          sql`update integration_connections set client_id = 'sneaky-client' where id = ${id}::uuid`,
        ),
      ),
      /only the display name can change while pending approval/,
    );
    await renameConnection(ctx, id, "Still fine");
  });
});

describe("integration_sync_runs frozen once finished", () => {
  it("refuses updating a finished run", async () => {
    const connId = await makeConnection(a);
    const runId = await makeRunningRun(a, connId);
    await finishRun(a, runId);
    await expectDbError(touchRunHeartbeat(a, runId), /a finished run cannot change/);
  });
});

describe("endpoint registry (SECURITY DEFINER claim/release)", () => {
  it("claims within the owning tenant and releases once revoked", async () => {
    const id = await makeConnection(a);
    expect(await claimRegistry(a, id)).toBe(true);
    await revokeConnection(a, id);
    expect(await releaseRegistry(a, id)).toBe(true);
  });

  it("practice A cannot claim or release practice B's entry", async () => {
    const id = await makeConnection(b);
    expect(await claimRegistry(a, id)).toBe(false);
    expect(await claimRegistry(b, id)).toBe(true);
    expect(await releaseRegistry(a, id)).toBe(false);
  });

  it("refuses a duplicate (endpoint, client id) claimed by a different practice", async () => {
    const sharedKey = `https://shared-${randomUUID().slice(0, 8)}.example.test/r4`;
    const idA = await makeConnection(a, {
      baseUrl: sharedKey,
      endpointKey: sharedKey,
      clientId: "dup-client",
    });
    const idB = await makeConnection(b, {
      baseUrl: sharedKey,
      endpointKey: sharedKey,
      clientId: "dup-client",
    });
    expect(await claimRegistry(a, idA)).toBe(true);
    expect(await claimRegistry(b, idB)).toBe(false);
  });

  it("release is enforced in the database: only draft or revoked may release", async () => {
    const ctx = await createTestTenant("Registry release guard");
    const id = await makeConnection(ctx);
    await claimRegistry(ctx, id);
    await submitForApproval(ctx, id);
    await expectDbError(
      withTenant(ctx, (tx) => tx.execute(sql`select integration_registry_release(${id}::uuid)`)),
      /is not draft or revoked/,
    );
  });

  it("never registers a sandbox connection", async () => {
    const id = await makeConnection(a, { isSandbox: true });
    expect(await claimRegistry(a, id)).toBe(true);
    const rows = await systemDb()
      .select({ id: integrationEndpointRegistry.id })
      .from(integrationEndpointRegistry)
      .where(eq(integrationEndpointRegistry.connectionId, id));
    expect(rows).toHaveLength(0);
  });
});

describe("patients_synced_readonly trigger", () => {
  it("refuses inserting a fhir row without a running sync run", async () => {
    const connId = await makeConnection(a);
    await expectDbError(
      withTenant(a, (tx) =>
        tx.insert(patients).values({
          tenantId: a.tenantId,
          mrn: "SYN-NORUN",
          firstName: "No",
          lastName: "Run",
          birthDate: "1990-01-01",
          source: "fhir",
          sourceConnectionId: connId,
          externalId: "ext-no-run",
        }),
      ),
      /can only be inserted by a running sync run/,
    );
  });

  it("allows the insert during a running sync run owned by the connection", async () => {
    const connId = await makeConnection(a);
    const runId = await makeRunningRun(a, connId);
    const patientId = await insertSyncedPatient(a, connId, runId);
    const [row] = await withTenant(a, (tx) =>
      tx.select({ source: patients.source }).from(patients).where(eq(patients.id, patientId)),
    );
    expect(row!.source).toBe("fhir");
  });

  it("refuses a manual edit of a synced column outside a running run", async () => {
    const connId = await makeConnection(a);
    const runId = await makeRunningRun(a, connId);
    const patientId = await insertSyncedPatient(a, connId, runId);
    await expectDbError(
      withTenant(a, (tx) => tx.update(patients).set({ city: "Hacked" }).where(eq(patients.id, patientId))),
      /synced fields can only change during a running sync run/,
    );
  });

  it("refuses fhir -> manual, even during a running run", async () => {
    const connId = await makeConnection(a);
    const runId = await makeRunningRun(a, connId);
    const patientId = await insertSyncedPatient(a, connId, runId);
    await expectDbError(
      withTenant(a, async (tx) => {
        await tx.execute(sql`select set_config('app.sync_run_id', ${runId}, true)`);
        await tx.execute(sql`select set_config('app.sync_connection_id', ${connId}, true)`);
        return tx.update(patients).set({ source: "manual" }).where(eq(patients.id, patientId));
      }),
      /a synced patient cannot become manual/,
    );
  });

  it("leaves sensitivity tags and phone (never synced) editable on a synced patient", async () => {
    const connId = await makeConnection(a);
    const runId = await makeRunningRun(a, connId);
    const patientId = await insertSyncedPatient(a, connId, runId);
    await withTenant(a, (tx) =>
      tx
        .update(patients)
        .set({ sensitivityTags: ["hiv"], phone: "8135550123" })
        .where(eq(patients.id, patientId)),
    );
    const [row] = await withTenant(a, (tx) =>
      tx
        .select({ sensitivityTags: patients.sensitivityTags, phone: patients.phone })
        .from(patients)
        .where(eq(patients.id, patientId)),
    );
    expect(row!.sensitivityTags).toEqual(["hiv"]);
    expect(row!.phone).toBe("8135550123");
  });
});

describe("domain refusals (src/domain/patients/queries.ts)", () => {
  it("still allows registering and editing patients when no connection exists", async () => {
    const ctx = await createTestTenant("No integration");
    const { id } = await withTenant(ctx, (tx) => createPatient(tx, actor(ctx), patientInput()));
    const before = await withTenant(ctx, (tx) =>
      tx
        .select({ updatedAt: patients.updatedAt, mrn: patients.mrn })
        .from(patients)
        .where(eq(patients.id, id)),
    );
    await withTenant(ctx, (tx) =>
      updatePatient(
        tx,
        actor(ctx),
        id,
        before[0]!.updatedAt.toISOString(),
        patientInput({ mrn: before[0]!.mrn, city: "Tampa" }),
        "No connection on file",
      ),
    );
  });

  it("refuses register and edit while the practice's Patients connection is outside draft/revoked", async () => {
    const ctx = await createTestTenant("Integration blocks manual entry");
    const { id: existingId } = await withTenant(ctx, (tx) => createPatient(tx, actor(ctx), patientInput()));
    const connId = await makeConnection(ctx);
    await submitForApproval(ctx, connId);

    await expect(withTenant(ctx, (tx) => createPatient(tx, actor(ctx), patientInput()))).rejects.toThrow(
      "connected to an EHR/PM",
    );
    const before = await withTenant(ctx, (tx) =>
      tx
        .select({ updatedAt: patients.updatedAt, mrn: patients.mrn })
        .from(patients)
        .where(eq(patients.id, existingId)),
    );
    await expect(
      withTenant(ctx, (tx) =>
        updatePatient(
          tx,
          actor(ctx),
          existingId,
          before[0]!.updatedAt.toISOString(),
          patientInput({ mrn: before[0]!.mrn, city: "Blocked" }),
          "Should be blocked",
        ),
      ),
    ).rejects.toThrow("connected to an EHR/PM");

    // Withdrawn back to draft: register and edit work again.
    await withTenant(ctx, (tx) =>
      tx.execute(sql`update integration_connections set status = 'draft' where id = ${connId}::uuid`),
    );
    await withTenant(ctx, (tx) => createPatient(tx, actor(ctx), patientInput()));
  });

  it("refuses updatePatient on a synced patient, but sensitivity tags stay editable", async () => {
    const connId = await makeConnection(b);
    const runId = await makeRunningRun(b, connId);
    const patientId = await insertSyncedPatient(b, connId, runId);
    await expect(
      withTenant(b, (tx) =>
        updatePatient(
          tx,
          actor(b),
          patientId,
          new Date().toISOString(),
          patientInput(),
          "Attempted manual edit",
        ),
      ),
    ).rejects.toThrow("can't be edited here");

    const result = await withTenant(b, (tx) =>
      updatePatientSensitivityTags(tx, b, patientId, ["hiv"], "Administrator flags restricted"),
    );
    expect(result.changed).toBe(true);
    const [row] = await withTenant(b, (tx) =>
      tx
        .select({ sensitivityTags: patients.sensitivityTags })
        .from(patients)
        .where(eq(patients.id, patientId)),
    );
    expect(row!.sensitivityTags).toEqual(["hiv"]);
  });
});
