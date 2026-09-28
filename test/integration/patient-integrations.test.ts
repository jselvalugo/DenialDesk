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
import { withTenant, withTenantAsPlatform } from "@/db/tenant";
import { createPatient, updatePatient, updatePatientSensitivityTags } from "@/domain/patients/queries";
import { patientSchema } from "@/domain/patients/record";
import { loadValuesForRecord, saveValuesForRecord } from "@/domain/custom-fields/values";
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

const SANDBOX_URL = "https://sandbox.fhir.denialdesk.invalid/r4";
const SANDBOX_CLIENT_ID = "sandbox-client";
const SANDBOX_TOKEN_ENDPOINT = "https://sandbox.fhir.denialdesk.invalid/token";

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
/** Inserts one draft connection as the practice (denialdesk_app), returning its id. */
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
  const isSandbox = overrides.isSandbox ?? false;
  const baseUrl = overrides.baseUrl ?? (isSandbox ? SANDBOX_URL : `https://${host}/r4`);
  const endpointKey = overrides.endpointKey ?? baseUrl;
  // A sandbox row's client_id is pinned by integration_connections_sandbox_is_builtin (final
  // review), so the per-call unique default only applies to a real connection.
  const clientId = overrides.clientId ?? (isSandbox ? SANDBOX_CLIENT_ID : `client-${seq}`);
  const mrnIdentifierSystem = `https://${host}/mrn`;
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

async function connectionRow(id: string) {
  const result = await systemDb().execute<{
    status: string;
    has_synced: boolean;
    is_sandbox: boolean;
  }>(sql`select status, has_synced, is_sandbox from integration_connections where id = ${id}::uuid`);
  return result.rows[0]!;
}

async function connectionStatus(id: string): Promise<string> {
  return (await connectionRow(id)).status;
}

/** Sets a column only writable while the connection is still draft (the endpoint set). */
async function setDraftField(ctx: Ctx, id: string, column: string, value: string) {
  // drizzle/0041: a token_endpoint_key can't exist apart from the token_endpoint it is derived from
  // (integration_connections_token_endpoint_key_matches_url), so the key fixtures set both, in one
  // statement, as discovery will.
  if (column === "token_endpoint_key") {
    return withTenant(ctx, (tx) =>
      tx.execute(
        sql`update integration_connections set token_endpoint = ${value}, token_endpoint_key = ${value} where id = ${id}::uuid`,
      ),
    );
  }
  return withTenant(ctx, (tx) =>
    tx.execute(sql`update integration_connections set ${sql.raw(column)} = ${value} where id = ${id}::uuid`),
  );
}

async function submitForApproval(ctx: Ctx, id: string) {
  await withTenant(ctx, (tx) =>
    tx.execute(sql`
      update integration_connections
      set status = 'pending_approval', submitted_by = ${ctx.userId}::uuid, submitted_at = now(),
          us_residency_attested_by = ${ctx.userId}::uuid, us_residency_attested_at = now()
      where id = ${id}::uuid
    `),
  );
}

/** The real operator path: table-owner privileges via withTenantAsPlatform, not the app role. */
async function approveAsOperator(ctx: Ctx, id: string) {
  await withTenantAsPlatform(ctx, (tx) =>
    tx.execute(sql`
      update integration_connections
      set status = 'active', approved_by = ${ctx.userId}::uuid, approved_at = now(),
          approval_method = 'phone_verified', population_scope = 'verified_filter'
      where id = ${id}::uuid
    `),
  );
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

/** Queues a sync run for `connectionId`, returning its id (still `queued`). */
async function queueRun(ctx: Ctx, connectionId: string): Promise<string> {
  const inserted = await withTenant(ctx, (tx) =>
    tx.execute<{ id: string }>(sql`
      insert into integration_sync_runs (tenant_id, connection_id, trigger, triggered_by)
      values (${ctx.tenantId}::uuid, ${connectionId}::uuid, 'manual', ${ctx.userId}::uuid)
      returning id
    `),
  );
  return inserted.rows[0]!.id;
}

async function startRun(ctx: Ctx, runId: string) {
  return withTenant(ctx, (tx) =>
    tx.execute(
      sql`update integration_sync_runs set status = 'running', started_at = now() where id = ${runId}::uuid`,
    ),
  );
}

/** A connection approved and active, plus a `running` sync run of it, ready to sync. */
async function makeRunningRun(ctx: Ctx, connectionId: string): Promise<string> {
  const runId = await queueRun(ctx, connectionId);
  await startRun(ctx, runId);
  return runId;
}

/**
 * Submits, approves, and activates a fresh real connection, with a token endpoint pinned, in its
 * own fresh tenant (only one connection per practice may be outside draft/revoked at a time —
 * `integration_connections_one_active` — so tests that need an active connection never share `a`/
 * `b` with each other).
 */
async function makeActiveConnection(label = "Active connection"): Promise<{ ctx: Ctx; connId: string }> {
  const ctx = await createTestTenant(`${label} ${randomUUID().slice(0, 6)}`);
  const id = await makeConnection(ctx);
  await setDraftField(ctx, id, "token_endpoint_key", `https://token-${id}.example.test/token`);
  await submitForApproval(ctx, id);
  // Final review, Low: activation now requires a claimed registry entry for a non-sandbox
  // connection (integration_connections_lifecycle), so the registry claim — which in the real
  // flow happens once submitted, before the operator can approve — has to happen here too.
  expect(await claimRegistry(ctx, id)).toBe(true);
  await approveAsOperator(ctx, id);
  return { ctx, connId: id };
}

async function finishRun(ctx: Ctx, runId: string, status: "succeeded" | "failed" = "succeeded") {
  await withTenant(ctx, (tx) =>
    tx.execute(
      sql`update integration_sync_runs set status = ${status}, finished_at = now() where id = ${runId}::uuid`,
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

/**
 * Inserts a `manual` patient row directly (bypassing `createPatient`'s register-open check), the
 * way a patient who already existed before an EHR/PM connection was set up would look. Used only
 * where the test's tenant has an active connection and `assertPatientsRegisterOpen` would
 * otherwise (correctly, per item 18) refuse `createPatient`.
 */
async function insertManualPatient(ctx: Ctx, overrides: Record<string, unknown> = {}): Promise<string> {
  const [row] = await systemDb()
    .insert(patients)
    .values({
      tenantId: ctx.tenantId,
      mrn: `SYN-MAN-${randomUUID().slice(0, 8)}`,
      firstName: "Manual",
      lastName: "Existing",
      birthDate: "1990-01-01",
      memberIdEnc: "x",
      memberIdLast4: "1234",
      ...overrides,
    })
    .returning({ id: patients.id });
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
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    const seenByB = await withTenant(b, (tx) =>
      tx.execute<{ id: string }>(sql`select id from integration_sync_runs where id = ${runId}::uuid`),
    );
    expect(seenByB.rows).toHaveLength(0);
    await expectDbError(
      withTenant(ctx, (tx) =>
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

  it("integration_sync_runs: refuses a composite FK across tenants (connection_id from another tenant)", async () => {
    const foreignConnId = await makeConnection(b);
    await expectDbError(
      withTenant(a, (tx) =>
        tx.execute(
          sql`insert into integration_sync_runs (tenant_id, connection_id, trigger) values (${a.tenantId}::uuid, ${foreignConnId}::uuid, 'manual')`,
        ),
      ),
      /row-level security|Integrity constraint violation/,
    );
  });

  it("integration_sync_issues: hides another practice's row, refuses cross-tenant insert/update, and a cross-tenant patient FK", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    const [issue] = await withTenant(ctx, (tx) =>
      tx
        .insert(integrationSyncIssues)
        .values({ tenantId: ctx.tenantId, runId, code: "mrn_missing" })
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
      withTenant(ctx, (tx) =>
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
    const [foreignPatient] = await withTenant(b, (tx) =>
      tx.select({ id: patients.id }).from(patients).limit(1),
    );
    if (foreignPatient) {
      await expectDbError(
        withTenant(ctx, (tx) =>
          tx
            .insert(integrationSyncIssues)
            .values({ tenantId: ctx.tenantId, runId, code: "mrn_missing", patientId: foreignPatient.id }),
        ),
        /row-level security|Integrity constraint violation/,
      );
    }
  });

  it("integration_payer_mappings: hides another practice's row, refuses cross-tenant insert/update, and a cross-tenant connection FK", async () => {
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
    const foreignConnId = await makeConnection(b);
    await expectDbError(
      withTenant(a, (tx) =>
        tx.insert(integrationPayerMappings).values({
          tenantId: a.tenantId,
          connectionId: foreignConnId,
          payorKey: "Organization/3",
          updatedBy: a.userId,
        }),
      ),
      /row-level security|Integrity constraint violation/,
    );
  });

  it("integration_endpoint_registry: the app role has no SELECT or INSERT privilege at all", async () => {
    await expectDbError(
      withTenant(a, (tx) => tx.select().from(integrationEndpointRegistry)),
      /permission denied/,
    );
    await expectDbError(
      withTenant(a, (tx) =>
        tx
          .insert(integrationEndpointRegistry)
          .values({ connectionId: randomUUID(), endpointKey: "x", clientId: "y" }),
      ),
      /permission denied/,
    );
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

describe("security review H1: sandbox self-activation", () => {
  it("refuses a sandbox row pointed at a real URL", async () => {
    await expectDbError(
      withTenant(a, (tx) =>
        tx.execute(sql`
          insert into integration_connections
            (tenant_id, display_name, base_url, endpoint_key, client_id, mrn_identifier_system, is_sandbox, created_by, updated_by)
          values (${a.tenantId}::uuid, 'Fake sandbox', 'https://not-the-sandbox.example.test/r4', 'https://not-the-sandbox.example.test/r4', 'c', 'https://x/mrn', true, ${a.userId}::uuid, ${a.userId}::uuid)
        `),
      ),
      /integration_connections_sandbox_is_builtin/,
    );
  });

  it("refuses a sandbox row with a real client_id (final review)", async () => {
    await expectDbError(
      withTenant(a, (tx) =>
        tx.execute(sql`
          insert into integration_connections
            (tenant_id, display_name, base_url, endpoint_key, client_id, mrn_identifier_system, is_sandbox, created_by, updated_by)
          values (${a.tenantId}::uuid, 'Fake sandbox client', ${SANDBOX_URL}, ${SANDBOX_URL}, 'not-the-sandbox-client', 'https://x/mrn', true, ${a.userId}::uuid, ${a.userId}::uuid)
        `),
      ),
      /integration_connections_sandbox_is_builtin/,
    );
  });

  it("refuses a sandbox row with a real token_endpoint or issuer (final review)", async () => {
    // token_endpoint/issuer aren't in the INSERT column grant (set by the app via UPDATE, once
    // draft, the same way a real connection's endpoint set is filled in) — set via setDraftField.
    const tokenId = await makeConnection(a, { isSandbox: true });
    await expectDbError(
      setDraftField(a, tokenId, "token_endpoint", "https://not-the-sandbox.example.test/token"),
      /integration_connections_sandbox_is_builtin/,
    );
    const issuerId = await makeConnection(a, { isSandbox: true });
    await expectDbError(
      setDraftField(a, issuerId, "issuer", "not-the-sandbox-issuer"),
      /integration_connections_sandbox_is_builtin/,
    );
  });

  it("allows a sandbox row whose token_endpoint/token_endpoint_key/issuer are null or the built-in constants", async () => {
    const id = await makeConnection(a, { isSandbox: true });
    await setDraftField(a, id, "token_endpoint", SANDBOX_TOKEN_ENDPOINT);
    await setDraftField(a, id, "token_endpoint_key", SANDBOX_TOKEN_ENDPOINT);
    await setDraftField(a, id, "issuer", SANDBOX_CLIENT_ID);
    expect(await connectionStatus(id)).toBe("draft");
  });

  it("refuses a non-sandbox connection reaching active/paused/error without a recorded approval (CHECK, independent of the trigger)", async () => {
    await expectDbError(
      systemDb().execute(sql`
        insert into integration_connections
          (tenant_id, display_name, base_url, endpoint_key, client_id, mrn_identifier_system, status, created_by, updated_by)
        values (${a.tenantId}::uuid, 'Skips approval', 'https://skip.example.test/r4', 'https://skip.example.test/r4', 'c', 'https://x/mrn', 'active', ${a.userId}::uuid, ${a.userId}::uuid)
      `),
      /integration_connections_approved_when_live/,
    );
  });

  it("never lets a sandbox connection go draft -> pending_approval", async () => {
    const id = await makeConnection(a, { isSandbox: true });
    await expectDbError(submitForApproval(a, id), /draft -> pending_approval is not allowed/);
  });

  it("still allows draft -> active directly for a sandbox connection", async () => {
    const ctx = await createTestTenant("Lifecycle sandbox");
    const id = await makeConnection(ctx, { isSandbox: true });
    await activateAsApp(ctx, id);
    expect(await connectionStatus(id)).toBe("active");
  });
});

describe("security review H2/B1/B2: the endpoint set only changes while draft", () => {
  const endpointColumns: [string, string][] = [
    ["base_url", "https://elsewhere.example.test/r4"],
    ["endpoint_key", "https://elsewhere.example.test/r4"],
    ["token_endpoint", "https://elsewhere.example.test/token"],
    ["token_endpoint_key", "https://elsewhere.example.test/token"],
    ["issuer", "https://elsewhere.example.test"],
    ["client_id", "new-client"],
    ["mrn_identifier_system", "https://elsewhere.example.test/mrn"],
    // Compliance review (final round): the residency attestation is locked with the rest of the
    // endpoint set (meaningless once submitted) — covered here with type-appropriate values, since
    // these two columns aren't text like the rest.
    ["us_residency_attested_by", randomUUID()],
    ["us_residency_attested_at", new Date().toISOString()],
  ];

  it.each(endpointColumns)(
    "refuses editing %s once approved and active (not yet synced)",
    async (column, value) => {
      const { ctx, connId: id } = await makeActiveConnection(`Endpoint lock ${column}`);
      await expectDbError(setDraftField(ctx, id, column, value), /the endpoint can only change while draft/);
    },
  );

  it("refuses token_endpoint in pending_approval", async () => {
    const ctx = await createTestTenant("Endpoint lock pending");
    const id = await makeConnection(ctx);
    await submitForApproval(ctx, id);
    await expectDbError(
      setDraftField(ctx, id, "token_endpoint", "https://elsewhere.example.test/token"),
      /the endpoint can only change while draft/,
    );
  });

  it("refuses endpoint_key once has_synced, even while still draft", async () => {
    const id = await makeConnection(a);
    await systemDb().execute(
      sql`update integration_connections set has_synced = true where id = ${id}::uuid`,
    );
    await expectDbError(
      setDraftField(a, id, "endpoint_key", "https://elsewhere.example.test/r4"),
      /endpoint fields are immutable once synced/,
    );
  });

  it("still allows the endpoint to change while draft", async () => {
    const id = await makeConnection(a);
    await setDraftField(a, id, "issuer", "https://issuer.example.test");
  });
});

describe("integration_connections lifecycle and editability trigger", () => {
  it("draft -> pending_approval is allowed, but only the operator may activate it", async () => {
    const ctx = await createTestTenant("Lifecycle activate");
    const id = await makeConnection(ctx);
    await setDraftField(ctx, id, "token_endpoint_key", `https://token-${id}.example.test/token`);
    await submitForApproval(ctx, id);
    await expectDbError(
      activateAsApp(ctx, id),
      /only the platform operator may activate a pending connection/,
    );
    expect(await claimRegistry(ctx, id)).toBe(true);
    await approveAsOperator(ctx, id);
    expect(await connectionStatus(id)).toBe("active");
  });

  it("refuses an invalid transition (draft -> active for a real connection)", async () => {
    const id = await makeConnection(a);
    await expectDbError(activateAsApp(a, id), /draft -> active is not allowed/);
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

  it("only the display name and bookkeeping columns may change while pending approval", async () => {
    const ctx = await createTestTenant("Lifecycle pending edits");
    const id = await makeConnection(ctx);
    await submitForApproval(ctx, id);
    await expectDbError(
      withTenant(ctx, (tx) =>
        tx.execute(
          sql`update integration_connections set client_id = 'sneaky-client' where id = ${id}::uuid`,
        ),
      ),
      /the endpoint can only change while draft/,
    );
    await expectDbError(
      withTenant(ctx, (tx) =>
        tx.execute(sql`update integration_connections set bulk_group_id = 'sneaky' where id = ${id}::uuid`),
      ),
      /only the display name can change while pending approval/,
    );
    await renameConnection(ctx, id, "Still fine");
  });

  it("security review M5: activation on data requires a fresh approval, not merely one carried over unchanged", async () => {
    const { ctx, connId: id } = await makeActiveConnection("Self-approval replay"); // approved once, approved_at = T1
    // Force back to pending_approval directly (defense-in-depth test only: this bypasses the
    // trigger's own transition table on purpose, to reach a state real code can never produce).
    await systemDb().execute(
      sql`alter table integration_connections disable trigger integration_connections_lifecycle`,
    );
    await systemDb().execute(
      sql`update integration_connections set status = 'pending_approval' where id = ${id}::uuid`,
    );
    await systemDb().execute(
      sql`alter table integration_connections enable trigger integration_connections_lifecycle`,
    );
    // The operator role passes the role check, but approved_at is unchanged from before.
    await expectDbError(
      withTenantAsPlatform(ctx, (tx) =>
        tx.execute(sql`update integration_connections set status = 'active' where id = ${id}::uuid`),
      ),
      /activation requires a fresh approval/,
    );
  });

  it("security review (final round, Low): activation of a non-sandbox connection requires a claimed registry entry", async () => {
    const ctx = await createTestTenant("Activate without registry");
    const id = await makeConnection(ctx);
    await setDraftField(ctx, id, "token_endpoint_key", `https://token-${id}.example.test/token`);
    await submitForApproval(ctx, id);
    // No claimRegistry call: the connection is pending_approval but never claimed the registry.
    await expectDbError(approveAsOperator(ctx, id), /activation requires a registry entry/);
    expect(await claimRegistry(ctx, id)).toBe(true);
    await approveAsOperator(ctx, id);
    expect(await connectionStatus(id)).toBe("active");
  });

  it("security review N5: lifecycle preconditions — pending_approval needs submission+attestation, revoked needs its fields, activation needs approval+scope", async () => {
    const id = await makeConnection(a);
    await expectDbError(
      systemDb().execute(
        sql`update integration_connections set status = 'pending_approval' where id = ${id}::uuid`,
      ),
      /integration_connections_pending_requires_submission/,
    );
    await expectDbError(
      systemDb().execute(sql`update integration_connections set status = 'revoked' where id = ${id}::uuid`),
      /integration_connections_revoked_requires_fields/,
    );
  });
});

describe("integration_sync_runs lifecycle (security review M4/N1)", () => {
  it("refuses a second queued run on the same connection (integration_sync_runs_one_active)", async () => {
    const { ctx, connId } = await makeActiveConnection();
    await queueRun(ctx, connId);
    await expectDbError(queueRun(ctx, connId), /integration_sync_runs_one_active/);
  });

  it("refuses updating a finished run", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    await finishRun(ctx, runId);
    await expectDbError(touchRunHeartbeat(ctx, runId), /a finished run cannot change/);
  });

  it("constrains transitions: queued only to running or abandoned", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await queueRun(ctx, connId);
    await expectDbError(
      withTenant(ctx, (tx) =>
        tx.execute(sql`update integration_sync_runs set status = 'succeeded' where id = ${runId}::uuid`),
      ),
      /integration_sync_runs_lifecycle: queued -> succeeded is not allowed/,
    );
  });

  it("requires the connection to be active before a run can start", async () => {
    const id = await makeConnection(a); // still draft, never activated
    const runId = await withTenant(a, (tx) =>
      tx.execute<{ id: string }>(sql`
        insert into integration_sync_runs (tenant_id, connection_id, trigger) values (${a.tenantId}::uuid, ${id}::uuid, 'manual') returning id
      `),
    ).then((r) => r.rows[0]!.id);
    await expectDbError(startRun(a, runId), /the connection must be active to run/);
  });

  // Split into two tenants/connections: `integration_connections_one_active` allows only one
  // connection per tenant outside draft/revoked, and `integration_sync_runs_one_active` (item 10)
  // allows only one queued/running run per connection, so a running run and a queued run can never
  // coexist on the same connection (or tenant) to be revoked together in a single test.
  it("revoking a connection abandons its running run", async () => {
    const { ctx, connId } = await makeActiveConnection("Revoke running");
    const runningId = await makeRunningRun(ctx, connId);
    await revokeConnection(ctx, connId);
    const rows = await systemDb().execute<{ status: string }>(
      sql`select status from integration_sync_runs where id = ${runningId}::uuid`,
    );
    expect(rows.rows[0]!.status).toBe("abandoned");
  });

  it("revoking a connection abandons its queued run", async () => {
    const { ctx, connId } = await makeActiveConnection("Revoke queued");
    const queuedId = await queueRun(ctx, connId);
    await revokeConnection(ctx, connId);
    const rows = await systemDb().execute<{ status: string }>(
      sql`select status from integration_sync_runs where id = ${queuedId}::uuid`,
    );
    expect(rows.rows[0]!.status).toBe("abandoned");
  });
});

describe("endpoint registry (SECURITY DEFINER claim/release)", () => {
  it("claims within the owning tenant (once submitted, with a token endpoint) and releases once revoked", async () => {
    const ctx = await createTestTenant("Registry claim/release");
    const id = await makeConnection(ctx);
    await setDraftField(ctx, id, "token_endpoint_key", `https://token-${id}.example.test/token`);
    await submitForApproval(ctx, id);
    expect(await claimRegistry(ctx, id)).toBe(true);
    await revokeConnection(ctx, id);
    expect(await releaseRegistry(ctx, id)).toBe(true);
  });

  it("security review M3: refuses claiming a draft connection (Submit hasn't happened yet)", async () => {
    const id = await makeConnection(a);
    await setDraftField(a, id, "token_endpoint_key", `https://token-${id}.example.test/token`);
    expect(await claimRegistry(a, id)).toBe(false);
  });

  it("security review H3: refuses claiming without a discovered token endpoint", async () => {
    const ctx = await createTestTenant("Claim without token endpoint");
    const id = await makeConnection(ctx);
    await submitForApproval(ctx, id);
    expect(await claimRegistry(ctx, id)).toBe(false);
  });

  it("practice A cannot claim or release practice B's entry", async () => {
    const owner = await createTestTenant("Registry owner B");
    const id = await makeConnection(owner);
    await setDraftField(owner, id, "token_endpoint_key", `https://token-${id}.example.test/token`);
    await submitForApproval(owner, id);
    expect(await claimRegistry(a, id)).toBe(false);
    expect(await claimRegistry(owner, id)).toBe(true);
    expect(await releaseRegistry(a, id)).toBe(false);
  });

  it("refuses a duplicate (endpoint, client id) claimed by a different practice", async () => {
    const ctxA = await createTestTenant("Duplicate endpoint A");
    const ctxB = await createTestTenant("Duplicate endpoint B");
    const sharedKey = `https://shared-${randomUUID().slice(0, 8)}.example.test/r4`;
    const idA = await makeConnection(ctxA, {
      baseUrl: sharedKey,
      endpointKey: sharedKey,
      clientId: "dup-client",
    });
    const idB = await makeConnection(ctxB, {
      baseUrl: sharedKey,
      endpointKey: sharedKey,
      clientId: "dup-client",
    });
    await setDraftField(ctxA, idA, "token_endpoint_key", `https://token-a-${idA}.example.test/token`);
    await setDraftField(ctxB, idB, "token_endpoint_key", `https://token-b-${idB}.example.test/token`);
    await submitForApproval(ctxA, idA);
    await submitForApproval(ctxB, idB);
    expect(await claimRegistry(ctxA, idA)).toBe(true);
    expect(await claimRegistry(ctxB, idB)).toBe(false);
  });

  it("security review H3: refuses a duplicate discovered token endpoint + client id even with a different base URL", async () => {
    const ctxA = await createTestTenant("Duplicate token A");
    const ctxB = await createTestTenant("Duplicate token B");
    const sharedToken = `https://shared-token-${randomUUID().slice(0, 8)}.example.test/token`;
    const idA = await makeConnection(ctxA, { clientId: "dup-token-client" });
    const idB = await makeConnection(ctxB, { clientId: "dup-token-client" });
    await setDraftField(ctxA, idA, "token_endpoint_key", sharedToken);
    await setDraftField(ctxB, idB, "token_endpoint_key", sharedToken);
    await submitForApproval(ctxA, idA);
    await submitForApproval(ctxB, idB);
    expect(await claimRegistry(ctxA, idA)).toBe(true);
    // Different base_url/endpoint_key (so the first unique key wouldn't catch it), same discovered
    // token endpoint + client id (so the second unique key must).
    expect(await claimRegistry(ctxB, idB)).toBe(false);
  });

  it("release is enforced in the database: only draft or revoked may release", async () => {
    const ctx = await createTestTenant("Registry release guard");
    const id = await makeConnection(ctx);
    await setDraftField(ctx, id, "token_endpoint_key", `https://token-${id}.example.test/token`);
    await submitForApproval(ctx, id);
    await claimRegistry(ctx, id);
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

  it("security review M2: PUBLIC cannot execute either function", async () => {
    const result = await systemDb().execute<{
      claim_public: boolean;
      release_public: boolean;
    }>(sql`
      select
        has_function_privilege('public', 'integration_registry_claim(uuid)', 'execute') as claim_public,
        has_function_privilege('public', 'integration_registry_release(uuid)', 'execute') as release_public
    `);
    expect(result.rows[0]).toEqual({ claim_public: false, release_public: false });
  });
});

describe("security review M1: search_path is fixed, pg_temp last", () => {
  it("a planted temp table named integration_connections is ignored by the definer functions", async () => {
    const ctx = await createTestTenant("Search path guard");
    const id = await makeConnection(ctx);
    await setDraftField(ctx, id, "token_endpoint_key", `https://token-${id}.example.test/token`);
    await submitForApproval(ctx, id);
    const client = await withTenant(ctx, async (tx) => {
      await tx.execute(sql`create temp table integration_connections (id uuid) on commit drop`);
      return tx.execute<{ claimed: boolean }>(sql`select integration_registry_claim(${id}::uuid) as claimed`);
    });
    // If the definer function had resolved the temp table instead of public.integration_connections,
    // it would find no matching row and return false; it must still see and claim the real one.
    expect(client.rows[0]!.claimed).toBe(true);
  });
});

describe("patients_synced_readonly trigger", () => {
  it("refuses inserting a fhir row without a running sync run", async () => {
    const { ctx, connId } = await makeActiveConnection();
    await expectDbError(
      withTenant(ctx, (tx) =>
        tx.insert(patients).values({
          tenantId: ctx.tenantId,
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

  it("refuses inserting naming a finished run", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    await finishRun(ctx, runId);
    await expectDbError(
      withTenant(ctx, async (tx) => {
        await tx.execute(sql`select set_config('app.sync_run_id', ${runId}, true)`);
        await tx.execute(sql`select set_config('app.sync_connection_id', ${connId}, true)`);
        return tx.insert(patients).values({
          tenantId: ctx.tenantId,
          mrn: "SYN-FINISHED",
          firstName: "Late",
          lastName: "Insert",
          birthDate: "1990-01-01",
          source: "fhir",
          sourceConnectionId: connId,
          externalId: "ext-finished",
        });
      }),
      /can only be inserted by a running sync run/,
    );
  });

  it("refuses naming a running run that belongs to a different connection in the same tenant", async () => {
    const { ctx, connId: connId1 } = await makeActiveConnection();
    const connId2 = await makeConnection(ctx); // a second, distinct connection; its own status doesn't matter here
    const runId1 = await makeRunningRun(ctx, connId1);
    await expectDbError(
      withTenant(ctx, async (tx) => {
        await tx.execute(sql`select set_config('app.sync_run_id', ${runId1}, true)`);
        // Claims to be running connection 2's run, but run 1 actually belongs to connection 1.
        await tx.execute(sql`select set_config('app.sync_connection_id', ${connId2}, true)`);
        return tx.insert(patients).values({
          tenantId: ctx.tenantId,
          mrn: "SYN-WRONGCONN",
          firstName: "Wrong",
          lastName: "Connection",
          birthDate: "1990-01-01",
          source: "fhir",
          sourceConnectionId: connId2,
          externalId: "ext-wrong-conn",
        });
      }),
      /can only be inserted by a running sync run/,
    );
  });

  it("refuses naming another tenant's run id", async () => {
    const { ctx: ctxA, connId: connIdA } = await makeActiveConnection();
    const { ctx: ctxB, connId: connIdB } = await makeActiveConnection();
    const runIdB = await makeRunningRun(ctxB, connIdB);
    await expectDbError(
      withTenant(ctxA, async (tx) => {
        await tx.execute(sql`select set_config('app.sync_run_id', ${runIdB}, true)`);
        await tx.execute(sql`select set_config('app.sync_connection_id', ${connIdA}, true)`);
        return tx.insert(patients).values({
          tenantId: ctxA.tenantId,
          mrn: "SYN-FOREIGNRUN",
          firstName: "Foreign",
          lastName: "Run",
          birthDate: "1990-01-01",
          source: "fhir",
          sourceConnectionId: connIdA,
          externalId: "ext-foreign-run",
        });
      }),
      /can only be inserted by a running sync run|row-level security/,
    );
  });

  it("allows the insert during a running sync run owned by the connection", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    const patientId = await insertSyncedPatient(ctx, connId, runId);
    const [row] = await withTenant(ctx, (tx) =>
      tx.select({ source: patients.source }).from(patients).where(eq(patients.id, patientId)),
    );
    expect(row!.source).toBe("fhir");
  });

  it("compliance review (final round): refuses inserting a fhir row with sensitivity tags already set", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    await expectDbError(
      insertSyncedPatient(ctx, connId, runId, { sensitivityTags: ["hiv"] }),
      /a synced row cannot be inserted with sensitivity tags set/,
    );
  });

  it("allows a positive synced-column update inside the owning run", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    const patientId = await insertSyncedPatient(ctx, connId, runId);
    await withTenant(ctx, async (tx) => {
      await tx.execute(sql`select set_config('app.sync_run_id', ${runId}, true)`);
      await tx.execute(sql`select set_config('app.sync_connection_id', ${connId}, true)`);
      return tx.update(patients).set({ city: "Synced City" }).where(eq(patients.id, patientId));
    });
    const [row] = await withTenant(ctx, (tx) =>
      tx.select({ city: patients.city }).from(patients).where(eq(patients.id, patientId)),
    );
    expect(row!.city).toBe("Synced City");
  });

  it("refuses a manual edit of a synced column outside a running run", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    const patientId = await insertSyncedPatient(ctx, connId, runId);
    await expectDbError(
      withTenant(ctx, (tx) => tx.update(patients).set({ city: "Hacked" }).where(eq(patients.id, patientId))),
      /synced fields can only change during a running sync run/,
    );
  });

  it("refuses fhir -> manual, even during a running run", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    const patientId = await insertSyncedPatient(ctx, connId, runId);
    await expectDbError(
      withTenant(ctx, async (tx) => {
        await tx.execute(sql`select set_config('app.sync_run_id', ${runId}, true)`);
        await tx.execute(sql`select set_config('app.sync_connection_id', ${connId}, true)`);
        return tx.update(patients).set({ source: "manual" }).where(eq(patients.id, patientId));
      }),
      /a synced patient cannot become manual/,
    );
  });

  it("refuses external_id/source_connection_id changing outside a running run", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    const patientId = await insertSyncedPatient(ctx, connId, runId);
    await expectDbError(
      withTenant(ctx, (tx) =>
        tx.update(patients).set({ externalId: "ext-changed" }).where(eq(patients.id, patientId)),
      ),
      /synced fields can only change during a running sync run/,
    );
  });

  it("links a manual patient to a source inside a running run, but refuses it outside one", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    // Inserted directly: the tenant already has an active connection, so `createPatient` would
    // correctly be refused by `assertPatientsRegisterOpen` (item 18) — this represents a manual
    // patient that predates the connection.
    const manualId = await insertManualPatient(ctx, { lastName: "Linkable" });

    await expectDbError(
      withTenant(ctx, (tx) =>
        tx
          .update(patients)
          .set({ source: "fhir", sourceConnectionId: connId, externalId: "ext-link-attempt" })
          .where(eq(patients.id, manualId)),
      ),
      /synced fields can only change during a running sync run/,
    );

    await withTenant(ctx, async (tx) => {
      await tx.execute(sql`select set_config('app.sync_run_id', ${runId}, true)`);
      await tx.execute(sql`select set_config('app.sync_connection_id', ${connId}, true)`);
      // patients_member_id_presence requires a fhir row's member id to be present iff
      // coverage_status is mapped/unmapped; the manual row's pre-existing member id (from
      // insertManualPatient) needs a matching coverage_status now that it's becoming a fhir row.
      return tx
        .update(patients)
        .set({
          source: "fhir",
          sourceConnectionId: connId,
          externalId: "ext-linked",
          coverageStatus: "mapped",
        })
        .where(eq(patients.id, manualId));
    });
    const [row] = await withTenant(ctx, (tx) =>
      tx.select({ source: patients.source }).from(patients).where(eq(patients.id, manualId)),
    );
    expect(row!.source).toBe("fhir");
  });

  it("leaves sensitivity tags and phone (never synced) editable on a synced patient outside a run", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    const patientId = await insertSyncedPatient(ctx, connId, runId);
    await withTenant(ctx, (tx) =>
      tx
        .update(patients)
        .set({ sensitivityTags: ["hiv"], phone: "8135550123" })
        .where(eq(patients.id, patientId)),
    );
    const [row] = await withTenant(ctx, (tx) =>
      tx
        .select({ sensitivityTags: patients.sensitivityTags, phone: patients.phone })
        .from(patients)
        .where(eq(patients.id, patientId)),
    );
    expect(row!.sensitivityTags).toEqual(["hiv"]);
    expect(row!.phone).toBe("8135550123");
  });

  it("compliance review #2: refuses sensitivity tags changing while a sync run's settings are set, even for a manual patient", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    const manualId = await insertManualPatient(ctx, { lastName: "Taggable" });
    await expectDbError(
      withTenant(ctx, async (tx) => {
        await tx.execute(sql`select set_config('app.sync_run_id', ${runId}, true)`);
        await tx.execute(sql`select set_config('app.sync_connection_id', ${connId}, true)`);
        return tx
          .update(patients)
          .set({ sensitivityTags: ["hiv"] })
          .where(eq(patients.id, manualId));
      }),
      /sensitivity tags cannot change during a sync run/,
    );
  });
});

describe("patients_member_id_presence CHECK", () => {
  async function insertPatient(ctx: Ctx, overrides: Record<string, unknown>) {
    return systemDb()
      .insert(patients)
      .values({
        tenantId: ctx.tenantId,
        mrn: `SYN-CHK-${randomUUID().slice(0, 8)}`,
        firstName: "Check",
        lastName: "Case",
        birthDate: "1990-01-01",
        ...overrides,
      });
  }

  /**
   * Inserts a `fhir`-sourced row inside a running sync run's session config, so the
   * `patients_synced_readonly` trigger's INSERT branch lets the row through and the
   * `patients_member_id_presence` CHECK is what actually gets exercised. `systemDb()` bypasses RLS
   * but not triggers, so `app.sync_run_id`/`app.sync_connection_id` still need to be set — inside a
   * transaction, since `set_config(..., true)` is transaction-local.
   */
  async function insertFhirPatient(
    ctx: Ctx,
    connId: string,
    runId: string,
    overrides: Record<string, unknown>,
  ) {
    return systemDb().transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.sync_run_id', ${runId}, true)`);
      await tx.execute(sql`select set_config('app.sync_connection_id', ${connId}, true)`);
      return tx.insert(patients).values({
        tenantId: ctx.tenantId,
        mrn: `SYN-CHK-${randomUUID().slice(0, 8)}`,
        firstName: "Check",
        lastName: "Case",
        birthDate: "1990-01-01",
        source: "fhir",
        sourceConnectionId: connId,
        ...overrides,
      });
    });
  }

  it("a manual row with a member ID is fine", async () => {
    await insertPatient(a, { source: "manual", memberIdEnc: "x", memberIdLast4: "1234" });
  });

  it("a manual row without a member ID is refused", async () => {
    await expectDbError(insertPatient(a, { source: "manual" }), /patients_member_id_presence/);
  });

  it("a fhir row mapped without a member ID is refused", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    await expectDbError(
      insertFhirPatient(ctx, connId, runId, {
        externalId: `ext-${randomUUID().slice(0, 8)}`,
        coverageStatus: "mapped",
      }),
      /patients_member_id_presence/,
    );
  });

  it("a fhir row with none coverage but a member ID set is refused", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    await expectDbError(
      insertFhirPatient(ctx, connId, runId, {
        externalId: `ext-${randomUUID().slice(0, 8)}`,
        coverageStatus: "none",
        memberIdEnc: "x",
        memberIdLast4: "1234",
      }),
      /patients_member_id_presence/,
    );
  });

  it("a fhir row mapped with a member ID is fine", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    await insertFhirPatient(ctx, connId, runId, {
      externalId: `ext-${randomUUID().slice(0, 8)}`,
      coverageStatus: "mapped",
      memberIdEnc: "x",
      memberIdLast4: "1234",
    });
  });
});

describe("integration_connections_one_active (partial unique index)", () => {
  it("refuses a second submit while one connection is already outside draft/revoked, and allows it after revoke", async () => {
    const ctx = await createTestTenant("One active connection");
    const first = await makeConnection(ctx);
    await submitForApproval(ctx, first);
    const second = await makeConnection(ctx);
    await expectDbError(submitForApproval(ctx, second), /integration_connections_one_active/);
    await revokeConnection(ctx, first);
    await submitForApproval(ctx, second);
    expect(await connectionStatus(second)).toBe("pending_approval");
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
      "while an EHR/PM connection is set up",
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
    ).rejects.toThrow("while an EHR/PM connection is set up");

    // Withdrawn back to draft: register and edit work again.
    await withTenant(ctx, (tx) =>
      tx.execute(sql`update integration_connections set status = 'draft' where id = ${connId}::uuid`),
    );
    await withTenant(ctx, (tx) => createPatient(tx, actor(ctx), patientInput()));
  });

  it("correctness review N8: the synced-patient message wins over the generic connection-open message", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    const patientId = await insertSyncedPatient(ctx, connId, runId);
    // The connection is active (outside draft/revoked), which alone would trigger the generic
    // message; the synced-patient message must be the one that actually surfaces.
    await expect(
      withTenant(ctx, (tx) =>
        updatePatient(
          tx,
          actor(ctx),
          patientId,
          new Date().toISOString(),
          patientInput(),
          "Attempted manual edit",
        ),
      ),
    ).rejects.toThrow("can't be edited here");
  });

  it("updatePatientSensitivityTags: refuses a non-administrator, an unknown tag, and otherwise works and audits", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    const patientId = await insertSyncedPatient(ctx, connId, runId);

    await expect(
      withTenant(ctx, (tx) =>
        updatePatientSensitivityTags(tx, { ...ctx, canTag: false }, patientId, ["hiv"], "Not an admin"),
      ),
    ).rejects.toThrow("Your role can view sensitivity tags but not change them.");

    await expect(
      withTenant(ctx, (tx) =>
        updatePatientSensitivityTags(
          tx,
          { ...ctx, canTag: true },
          patientId,
          ["not_a_real_tag" as never],
          "Bad tag",
        ),
      ),
    ).rejects.toThrow("That is not a recognized sensitivity tag.");

    const result = await withTenant(ctx, (tx) =>
      updatePatientSensitivityTags(
        tx,
        { ...ctx, canTag: true },
        patientId,
        ["hiv"],
        "Administrator flags restricted",
      ),
    );
    expect(result.changed).toBe(true);
    const [row] = await withTenant(ctx, (tx) =>
      tx
        .select({ sensitivityTags: patients.sensitivityTags })
        .from(patients)
        .where(eq(patients.id, patientId)),
    );
    expect(row!.sensitivityTags).toEqual(["hiv"]);
    const [event] = await systemDb()
      .execute<{ metadata: unknown }>(
        sql`
        select metadata from audit_events
        where action = 'patient.sensitivity_changed' and entity_id = ${patientId}::uuid
        order by id desc limit 1
      `,
      )
      .then((r) => r.rows);
    expect(event!.metadata).toEqual({ added: "hiv", removed: "" });
  });

  it("correctness review N3: custom field values still save on a synced patient (through saveValuesForRecord)", async () => {
    const { ctx, connId } = await makeActiveConnection();
    const runId = await makeRunningRun(ctx, connId);
    const patientId = await insertSyncedPatient(ctx, connId, runId);
    const [field] = await withTenant(ctx, (tx) =>
      tx.execute<{ id: string }>(sql`
        insert into custom_fields (tenant_id, entity, key, label, field_type, created_by)
        values (${ctx.tenantId}::uuid, 'patient', 'notes_synced', 'Notes', 'text', ${ctx.userId}::uuid)
        returning id
      `),
    ).then((r) => r.rows);
    // Goes through the real domain entry points, not raw SQL, so lockRecordRow's `FOR NO KEY
    // UPDATE` on `patients` runs against the synced row too (it's a lock, not an UPDATE, so it
    // can't trip patients_synced_readonly).
    await withTenant(ctx, (tx) =>
      saveValuesForRecord(
        tx,
        { ...ctx, role: "admin" },
        "patient",
        patientId,
        new Map([[field!.id, "Synced patient note"]]),
      ),
    );
    const values = await withTenant(ctx, (tx) =>
      loadValuesForRecord(tx, { ...ctx, role: "admin" }, "patient", patientId),
    );
    const saved = values.find((v) => v.fieldId === field!.id);
    expect(saved?.masked).toBe(false);
    expect(saved?.value).toBe("Synced patient note");
  });
});
