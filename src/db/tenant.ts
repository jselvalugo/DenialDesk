import { sql } from "drizzle-orm";
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
