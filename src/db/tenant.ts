import { DrizzleQueryError, sql } from "drizzle-orm";
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
    readonly constraint?: string,
  ) {
    super(message);
    this.name = "DatabaseError";
  }
}

const SQLSTATE = /^[0-9A-Z]{5}$/;
// Constraint and index names are schema identifiers; anything else is not trusted into a message.
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;

interface PgErrorFields {
  code?: unknown;
  message?: unknown;
  constraint?: unknown;
}

/** A node-postgres server error thrown without Drizzle's wrapper (it carries `severity` and a SQLSTATE). */
function isBarePgError(error: unknown): error is Error & PgErrorFields {
  const fields = error as { code?: unknown; severity?: unknown } | null;
  return (
    error instanceof Error &&
    typeof fields?.severity === "string" &&
    typeof fields.code === "string" &&
    SQLSTATE.test(fields.code)
  );
}

/**
 * Drizzle puts query parameters in its error message, and PostgreSQL puts row values in `detail`
 * (e.g. `Key (tenant_id, mrn)=(…) already exists`, `Failing row contains (…)`); Next.js logs
 * unhandled errors. Replace database errors with a fresh DatabaseError that never carries the
 * original error, its `detail`, or its `cause` (CLAUDE.md #4, R-7.4.8):
 * - integrity violations (SQLSTATE class 23): SQLSTATE and constraint name only;
 * - data exceptions (class 22, which quote the offending value): SQLSTATE only;
 * - other server errors: the PostgreSQL message, which names objects rather than values (RLS,
 *   permission, and trigger errors; triggers raise with IDs and workflow text only);
 * - failures with no SQLSTATE (connection loss, driver errors): a generic message.
 * Non-database errors (redirects, notFound) pass through untouched.
 */
export function sanitizeDatabaseError(error: unknown): unknown {
  if (error instanceof DatabaseError) return error;
  let pg: PgErrorFields | undefined;
  if (error instanceof DrizzleQueryError) pg = (error.cause ?? {}) as PgErrorFields;
  else if (isBarePgError(error)) pg = error;
  else if (error instanceof Error && typeof (error.cause as PgErrorFields | undefined)?.code === "string")
    pg = error.cause as PgErrorFields;
  else return error;

  const code = typeof pg.code === "string" && SQLSTATE.test(pg.code) ? pg.code : undefined;
  const constraint =
    typeof pg.constraint === "string" && IDENTIFIER.test(pg.constraint) ? pg.constraint : undefined;
  let message = "Database query failed";
  if (code?.startsWith("23")) {
    message = `Integrity constraint violation (SQLSTATE ${code})${constraint ? ` on "${constraint}"` : ""}`;
  } else if (code && !code.startsWith("22") && typeof pg.message === "string") {
    message = pg.message;
  }
  log.error("db.query_failed", { status: code ?? "unknown", ...(constraint ? { constraint } : {}) });
  return new DatabaseError(message, code, constraint);
}
