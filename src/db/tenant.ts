import { sql } from "drizzle-orm";
import { INTEGRATION_SERVICE_PRINCIPAL_ID } from "./integration-principal";
import { systemDb, type Database } from "./client";
import { sanitizeDatabaseError } from "./errors";

export { DatabaseError, isDatabaseError, isUniqueViolation, sanitizeDatabaseError } from "./errors";

export type TenantTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface TenantContext {
  tenantId: string;
  userId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` in a transaction as the restricted `denialdesk_app` role with `app.tenant_id` set, so
 * row-level security limits every statement to one tenant (R-7.2.4). The only way application code
 * should read or write practice data.
 */
export async function withTenant<T>(ctx: TenantContext, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  if (!UUID.test(ctx.tenantId) || !UUID.test(ctx.userId)) {
    throw new Error("withTenant requires UUID tenant and user IDs");
  }
  try {
    return await systemDb().transaction(async (tx) => {
      await tx.execute(sql`set local role denialdesk_app`);
      await tx.execute(sql`select set_config('app.tenant_id', ${ctx.tenantId}, true)`);
      await tx.execute(sql`select set_config('app.user_id', ${ctx.userId}, true)`);
      return fn(tx);
    });
  } catch (error) {
    throw sanitizeDatabaseError(error);
  }
}

/**
 * Runs `fn` as the schema owner with `app.tenant_id` set but WITHOUT switching to the restricted
 * app role, so column privileges the app role lacks (e.g. `university_access.granted_at`) are
 * available. It has the owner's full privileges: tables without a tenant policy (users, tenants,
 * memberships, audit_events) are fully writable, and a superuser or BYPASSRLS connection (local
 * development, CI) ignores the policy altogether. The tenant policy is defense in depth only;
 * every statement inside `fn` must name the practice explicitly. For the platform operator's
 * writes to a practice's records (src/domain/platform/university-access.ts) only, never from a
 * practice session. `userId` is the operator, recorded as `app.user_id`.
 */
export async function withTenantAsPlatform<T>(
  ctx: TenantContext,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!UUID.test(ctx.tenantId) || !UUID.test(ctx.userId)) {
    throw new Error("withTenantAsPlatform requires UUID tenant and user IDs");
  }
  try {
    return await systemDb().transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${ctx.tenantId}, true)`);
      await tx.execute(sql`select set_config('app.user_id', ${ctx.userId}, true)`);
      return fn(tx);
    });
  } catch (error) {
    throw sanitizeDatabaseError(error);
  }
}

/** What `withTenantAsSystem` tells `fn` about the run it was opened for. */
export interface SystemRunContext {
  runId: string;
  /** The run's own connection, read under the tenant's row-level security policy. */
  connectionId: string;
}

/**
 * Runs `fn` as the integration sync engine for one run (docs/specs/patient-integrations.md "PI2b";
 * ADR 0010). It is **not** `withTenantAsPlatform` and **not** `systemDb` access: the transaction runs
 * as the restricted `denialdesk_app` role with `app.tenant_id` set, so row-level security limits every
 * statement to the run's practice, exactly as for a signed-in user. The actor (`app.user_id`) is the
 * fixed integration service principal (`INTEGRATION_SERVICE_PRINCIPAL_ID`, seeded by drizzle/0043),
 * never a person; the administrator who pressed Sync now is recorded in the audit metadata instead.
 *
 * The run's connection is looked up first (a run that isn't in this tenant is refused, so a forged or
 * cross-tenant `runId` finds nothing), then `app.sync_run_id` and `app.sync_connection_id` are set so
 * the `patients_synced_readonly` trigger will accept the engine's writes, and only while that run is
 * `running` for an `active` connection. Both are set with `set_config(..., true)`: transaction-local
 * (`is_local = true`), never session-level, so a pooled connection reused by another request can't
 * inherit a stale run setting that the trigger would then trust.
 */
export async function withTenantAsSystem<T>(
  tenantId: string,
  runId: string,
  fn: (tx: TenantTx, run: SystemRunContext) => Promise<T>,
): Promise<T> {
  if (!UUID.test(tenantId) || !UUID.test(runId)) {
    throw new Error("withTenantAsSystem requires UUID tenant and run IDs");
  }
  try {
    return await systemDb().transaction(async (tx) => {
      await tx.execute(sql`set local role denialdesk_app`);
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      await tx.execute(sql`select set_config('app.user_id', ${INTEGRATION_SERVICE_PRINCIPAL_ID}, true)`);
      const found = await tx.execute<{ connection_id: string }>(
        sql`select connection_id from integration_sync_runs where id = ${runId}::uuid and tenant_id = ${tenantId}::uuid`,
      );
      const connectionId = found.rows[0]?.connection_id;
      if (!connectionId) throw new Error("withTenantAsSystem: no such run in this practice");
      await tx.execute(sql`select set_config('app.sync_run_id', ${runId}, true)`);
      await tx.execute(sql`select set_config('app.sync_connection_id', ${connectionId}, true)`);
      return fn(tx, { runId, connectionId });
    });
  } catch (error) {
    throw sanitizeDatabaseError(error);
  }
}
