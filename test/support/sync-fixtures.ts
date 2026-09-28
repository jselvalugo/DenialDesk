import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { integrationSyncIssues, patients, payers } from "@/db/schema";
import { withTenant, withTenantAsPlatform } from "@/db/tenant";
import { createTestTenant } from "../integration/helpers";

// Synthetic fixtures for the PI2b pages (payer mapping, sync history): a practice with an active
// connection, a running sync run, synced patients that carry payor keys, and issue rows, all written
// the way the application's own paths write them (the practice's role and the run's settings), so the
// database's triggers and row-level security apply. No migration and no sync engine are involved:
// the sync engine is another slice, so these rows stand in for what it will write. Synthetic data only
// (`SYN` identifiers, invented names).

export type Ctx = { tenantId: string; userId: string };

/**
 * A fresh practice with one real connection that is `active` (submitted, registry claimed, approved
 * as the owner does it). Fresh per call: only one connection per practice may be outside
 * draft/revoked.
 */
export async function practiceWithActiveConnection(
  label = "Sync UI",
): Promise<{ ctx: Ctx; connectionId: string }> {
  const ctx = await createTestTenant(`${label} ${randomUUID().slice(0, 6)}`);
  const host = `ehr-${randomUUID().slice(0, 8)}.example.test`;
  const created = await withTenant(ctx, (tx) =>
    tx.execute<{ id: string }>(sql`
      insert into integration_connections
        (tenant_id, display_name, base_url, endpoint_key, client_id, mrn_identifier_system, created_by, updated_by)
      values (${ctx.tenantId}::uuid, 'Synthetic EHR', ${`https://${host}/r4`}, ${`https://${host}/r4`},
              ${`client-${randomUUID().slice(0, 8)}`}, ${`https://${host}/mrn`}, ${ctx.userId}::uuid, ${ctx.userId}::uuid)
      returning id
    `),
  );
  const connectionId = created.rows[0]!.id;
  const token = `https://${host}/token`;
  await withTenant(ctx, async (tx) => {
    await tx.execute(
      sql`update integration_connections set token_endpoint = ${token}, token_endpoint_key = ${token} where id = ${connectionId}::uuid`,
    );
    await tx.execute(sql`
      update integration_connections
      set status = 'pending_approval', submitted_by = ${ctx.userId}::uuid, submitted_at = now(),
          us_residency_attested_by = ${ctx.userId}::uuid, us_residency_attested_at = now()
      where id = ${connectionId}::uuid
    `);
    await tx.execute(sql`select integration_registry_claim(${connectionId}::uuid)`);
  });
  // The operator's path: the connection owner's privileges with the practice's tenant set.
  await withTenantAsPlatform(ctx, (tx) =>
    tx.execute(sql`
      update integration_connections
      set status = 'active', approved_by = ${ctx.userId}::uuid, approved_at = now(),
          approval_method = 'video_call', population_scope = 'group_export'
      where id = ${connectionId}::uuid
    `),
  );
  return { ctx, connectionId };
}

/** Queues and starts a run (`running`), as the sync engine will, returning its id. */
export async function runningRun(ctx: Ctx, connectionId: string): Promise<string> {
  const queued = await withTenant(ctx, (tx) =>
    tx.execute<{ id: string }>(sql`
      insert into integration_sync_runs (tenant_id, connection_id, trigger, triggered_by)
      values (${ctx.tenantId}::uuid, ${connectionId}::uuid, 'manual', ${ctx.userId}::uuid)
      returning id
    `),
  );
  const runId = queued.rows[0]!.id;
  await withTenant(ctx, (tx) =>
    tx.execute(
      sql`update integration_sync_runs set status = 'running', started_at = now() where id = ${runId}::uuid`,
    ),
  );
  return runId;
}

/** Ends a run with its counts, issue codes, and HTTP status (a finished run is frozen by trigger). */
export async function finishRun(
  ctx: Ctx,
  runId: string,
  result: {
    status?: "succeeded" | "failed";
    created?: number;
    updated?: number;
    linked?: number;
    skipped?: number;
    issueCodes?: string[];
    httpStatus?: number | null;
  } = {},
): Promise<void> {
  const codes = `{${(result.issueCodes ?? []).join(",")}}`;
  await withTenant(ctx, (tx) =>
    tx.execute(sql`
      update integration_sync_runs
      set status = ${result.status ?? "succeeded"}, finished_at = now(),
          created_count = ${result.created ?? 0}, updated_count = ${result.updated ?? 0},
          linked_count = ${result.linked ?? 0}, skipped_count = ${result.skipped ?? 0},
          issue_codes = ${codes}::text[], http_status = ${result.httpStatus ?? null}
      where id = ${runId}::uuid
    `),
  );
}

/**
 * A synced (`fhir`) patient of the connection carrying `payorKey`, inserted with the run's settings in
 * place (the read-only trigger admits nothing else). Returns its DenialDesk ID.
 */
export async function syncedPatient(
  ctx: Ctx,
  connectionId: string,
  runId: string,
  payorKey: string | null,
): Promise<string> {
  const covered = payorKey !== null;
  const [row] = await withTenant(ctx, async (tx) => {
    await tx.execute(sql`select set_config('app.sync_run_id', ${runId}, true)`);
    await tx.execute(sql`select set_config('app.sync_connection_id', ${connectionId}, true)`);
    return tx
      .insert(patients)
      .values({
        tenantId: ctx.tenantId,
        mrn: `SYN-${randomUUID().slice(0, 8)}`,
        firstName: "Synthia",
        lastName: "Testpatient",
        birthDate: "1990-01-01",
        source: "fhir",
        sourceConnectionId: connectionId,
        externalId: `ext-${randomUUID().slice(0, 8)}`,
        coverageStatus: covered ? "unmapped" : "none",
        coveragePayorKey: payorKey,
        memberIdEnc: covered ? "SYN-ENCRYPTED" : null,
        memberIdLast4: covered ? "1234" : null,
      })
      .returning({ id: patients.id });
  });
  return row!.id;
}

/** One issue row of a run (append-only), with the DenialDesk patient it is about, if any. */
export async function issueRow(
  ctx: Ctx,
  runId: string,
  code: string,
  patientId: string | null = null,
): Promise<string> {
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .insert(integrationSyncIssues)
      .values({ tenantId: ctx.tenantId, runId, code, patientId })
      .returning({ id: integrationSyncIssues.id }),
  );
  return row!.id;
}

/** A payer of the practice (owner insert: payers are practice reference data). */
export async function payerOf(ctx: Ctx, name: string): Promise<string> {
  const [row] = await systemDb()
    .insert(payers)
    .values({ tenantId: ctx.tenantId, name })
    .returning({ id: payers.id });
  return row!.id;
}
