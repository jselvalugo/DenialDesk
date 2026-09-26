import { sql } from "drizzle-orm";
import { systemDb, type Database } from "./client";
import { sanitizeDatabaseError } from "./errors";

export { DatabaseError, isUniqueViolation, sanitizeDatabaseError } from "./errors";

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
