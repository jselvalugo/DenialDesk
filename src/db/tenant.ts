import { sql } from "drizzle-orm";
import { log } from "@/lib/log";
import { systemDb, type Database } from "./client";

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

/** A database failure with the query parameters (which can hold PHI) stripped out. */
export class DatabaseError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = "DatabaseError";
  }
}

/**
 * Drizzle puts query parameters in its error message; Next.js logs unhandled errors. Replace
 * database errors with the PostgreSQL message and code only (Postgres messages name tables and
 * constraints, not values; data exceptions, which can quote a value, keep only their code). Non-database errors (redirects, notFound) pass through untouched.
 */
export function sanitizeDatabaseError(error: unknown): unknown {
  const cause =
    error instanceof Error ? (error.cause as { code?: unknown; message?: unknown } | undefined) : undefined;
  const isDrizzle = error instanceof Error && error.name === "DrizzleQueryError";
  if (!isDrizzle && typeof cause?.code !== "string") return error;
  const code = typeof cause?.code === "string" ? cause.code : undefined;
  // Data exceptions (SQLSTATE class 22, e.g. "date/time field value out of range: \"…\"") quote
  // the offending value, so only their code is kept.
  const message =
    typeof cause?.message === "string" && !code?.startsWith("22") ? cause.message : "Database query failed";
  log.error("db.query_failed", { status: code ?? "unknown" });
  return new DatabaseError(message, code);
}
