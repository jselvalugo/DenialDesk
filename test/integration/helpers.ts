import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { DatabaseError } from "@/db/errors";
import { locations, memberships, patients, payers, providers, tenants, users } from "@/db/schema";
import { withTenant, withTenantAsPlatform } from "@/db/tenant";

/** Creates an isolated synthetic tenant with one admin user. */
export async function createTestTenant(label = "Test") {
  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await systemDb()
    .insert(tenants)
    .values({ name: `${label} practice ${suffix} (synthetic)` })
    .returning();
  const [user] = await systemDb()
    .insert(users)
    .values({
      email: `admin-${suffix}@synthetic.test`,
      displayName: `Synthetic Admin ${suffix}`,
      passwordHash: "not-used",
    })
    .returning();
  await systemDb().insert(memberships).values({ tenantId: tenant!.id, userId: user!.id, role: "admin" });
  return { tenantId: tenant!.id, userId: user!.id };
}

/** Asserts a query fails with a sanitized database error whose message matches `pattern`. */
export async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (error) {
    // Every query error is a DatabaseError without a cause (src/db/errors.ts).
    const message = (error as Error).message;
    if (error instanceof DatabaseError && pattern.test(message)) return;
    throw new Error(`Expected database error matching ${pattern}, got: ${(error as Error).name}: ${message}`);
  }
  throw new Error(`Expected database error matching ${pattern}, but the query succeeded`);
}

/**
 * A random UUID whose first hex digit is `prefix`, so tie-break tests control id order (P4 review):
 * give the row expected *first* the higher prefix and a regression to an id-only tie-break fails on
 * every run instead of about half of them.
 */
export function uuidWithPrefix(prefix: string): string {
  if (!/^[0-9a-f]$/.test(prefix)) throw new Error("uuidWithPrefix takes one lowercase hex digit");
  return `${prefix}${randomUUID().slice(1)}`;
}

// ---------------------------------------------------------------------------------------------
// Patient-integration fixtures shared by the sync, patient-integration, and charge-import tests.
// ---------------------------------------------------------------------------------------------

type Ctx = { tenantId: string; userId: string };
const SANDBOX_URL = "https://sandbox.fhir.denialdesk.invalid/r4";
const SANDBOX_CLIENT_ID = "sandbox-client";
let seq = 0;

/** Inserts one draft connection as the practice (denialdesk_app), returning its id. */
export async function makeConnection(
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

/** Sets a column only writable while the connection is still draft (the endpoint set). */
export async function setDraftField(ctx: Ctx, id: string, column: string, value: string) {
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

export async function submitForApproval(ctx: Ctx, id: string) {
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
export async function approveAsOperator(ctx: Ctx, id: string) {
  await withTenantAsPlatform(ctx, (tx) =>
    tx.execute(sql`
      update integration_connections
      set status = 'active', approved_by = ${ctx.userId}::uuid, approved_at = now(),
          approval_method = 'phone_verified', population_scope = 'verified_filter'
      where id = ${id}::uuid
    `),
  );
}

/** Queues a sync run for `connectionId`, returning its id (still `queued`). */
export async function queueRun(ctx: Ctx, connectionId: string): Promise<string> {
  const inserted = await withTenant(ctx, (tx) =>
    tx.execute<{ id: string }>(sql`
      insert into integration_sync_runs (tenant_id, connection_id, trigger, triggered_by)
      values (${ctx.tenantId}::uuid, ${connectionId}::uuid, 'manual', ${ctx.userId}::uuid)
      returning id
    `),
  );
  return inserted.rows[0]!.id;
}

export async function startRun(ctx: Ctx, runId: string) {
  return withTenant(ctx, (tx) =>
    tx.execute(
      sql`update integration_sync_runs set status = 'running', started_at = now() where id = ${runId}::uuid`,
    ),
  );
}

/** A connection approved and active, plus a `running` sync run of it, ready to sync. */
export async function makeRunningRun(ctx: Ctx, connectionId: string): Promise<string> {
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
export async function makeActiveConnection(
  label = "Active connection",
): Promise<{ ctx: Ctx; connId: string }> {
  const ctx = await createTestTenant(`${label} ${randomUUID().slice(0, 6)}`);
  const id = await makeConnection(ctx);
  await setDraftField(ctx, id, "token_endpoint_key", `https://token-${id}.example.test/token`);
  await submitForApproval(ctx, id);
  // Final review, Low: activation now requires a claimed registry entry for a non-sandbox
  // connection (integration_connections_lifecycle), so the registry claim — which in the real
  // flow happens once submitted, before the operator can approve — has to happen here too.
  if (!(await claimRegistry(ctx, id))) throw new Error("registry claim failed");
  await approveAsOperator(ctx, id);
  return { ctx, connId: id };
}

/** Inserts a `fhir` patient row the way a sync run would: with the run's settings in place. */
export async function insertSyncedPatient(
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

export async function claimRegistry(ctx: Ctx, connectionId: string): Promise<boolean> {
  const result = await withTenant(ctx, (tx) =>
    tx.execute<{ claimed: boolean }>(
      sql`select integration_registry_claim(${connectionId}::uuid) as claimed`,
    ),
  );
  return result.rows[0]!.claimed;
}

// ---------------------------------------------------------------------------------------------
// Charge-import fixtures (docs/specs/claims.md C2): a practice with providers, locations, payers, and
// manual synthetic patients SYN-901001 to SYN-901005.
// ---------------------------------------------------------------------------------------------

export interface ChargeImportPractice {
  tenantId: string;
  userId: string;
  providerId: string;
  locationId: string;
  otherProviderId: string;
  otherProviderNpi: string;
  otherLocationName: string;
}

export async function seedChargeImportPractice(
  ctx: { tenantId: string; userId: string },
  extras: { onlyHere?: boolean } = {},
): Promise<ChargeImportPractice> {
  const db = systemDb();
  const [provider] = await db
    .insert(providers)
    .values({ tenantId: ctx.tenantId, name: "Dr. Synthetic One", npi: "1111111111", taxonomy: "207Q00000X" })
    .returning({ id: providers.id });
  const [other] = await db
    .insert(providers)
    .values({ tenantId: ctx.tenantId, name: "Dr. Synthetic Two", npi: "2222222222", taxonomy: "207R00000X" })
    .returning({ id: providers.id });
  const [location] = await db
    .insert(locations)
    .values({ tenantId: ctx.tenantId, name: "Bayshore Clinic (synthetic)", city: "Tampa" })
    .returning({ id: locations.id });
  await db
    .insert(locations)
    .values({ tenantId: ctx.tenantId, name: "Lake Clinic (synthetic)", city: "Orlando" });
  await db.insert(payers).values([
    {
      tenantId: ctx.tenantId,
      name: "Gulf Coast Mutual (synthetic)",
      ediPayerId: "SYNTH01",
      regime: "fl_insurer",
    },
    {
      tenantId: ctx.tenantId,
      name: "Medicare Part B (synthetic)",
      ediPayerId: "SYNTH02",
      regime: "medicare",
    },
    { tenantId: ctx.tenantId, name: "Sunward HMO (synthetic)", ediPayerId: "SYNTH03", regime: "fl_hmo" },
    { tenantId: ctx.tenantId, name: "Unverified Health (synthetic)" },
  ]);
  if (extras.onlyHere) {
    await db.insert(payers).values({
      tenantId: ctx.tenantId,
      name: "Only In Practice B (synthetic)",
      ediPayerId: "SYNTH09",
      regime: "fl_insurer",
    });
  }
  await db.insert(patients).values(
    ["SYN-901001", "SYN-901002", "SYN-901003", "SYN-901004", "SYN-901005"].map((mrn, i) => ({
      tenantId: ctx.tenantId,
      mrn,
      firstName: `Synthia${i}`,
      lastName: "Testpatient",
      birthDate: "1980-01-01",
      memberIdEnc: "not-a-real-ciphertext",
      memberIdLast4: "0000",
    })),
  );
  return {
    ...ctx,
    providerId: provider!.id,
    locationId: location!.id,
    otherProviderId: other!.id,
    otherProviderNpi: "2222222222",
    otherLocationName: "Lake Clinic (synthetic)",
  };
}
