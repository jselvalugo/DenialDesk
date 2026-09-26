import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { serverEnv } from "@/lib/env";
import { netlifyDatabaseUrl } from "@/platform/netlify/database";
import { log } from "@/lib/log";
import { installQueryErrorSanitizer, sanitizeConnectionError, sqlStateOf } from "./errors";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let database: Database | undefined;

/** DATABASE_URL when set (local, CI, Azure); otherwise the platform-provided Netlify database. */
export function databaseUrl(): string {
  const url = serverEnv().DATABASE_URL ?? netlifyDatabaseUrl();
  if (!url)
    throw new Error("No database configured: set DATABASE_URL (or deploy on Netlify with Netlify Database)");
  return url;
}

function getPool(): Pool {
  if (pool) return pool;
  const created = new Pool({
    connectionString: databaseUrl(),
    max: 10,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 30_000,
  });
  // An idle client dropped by the server (restart, suspend) is emitted here; unhandled, it would
  // crash the process and print the raw error. Log the SQLSTATE only.
  created.on("error", (error) => log.warn("db.pool_error", { status: sqlStateOf(error) ?? "unknown" }));
  // Drizzle checks out a client for each transaction outside its query path; sanitize that too.
  // (pool.query uses the callback form internally, whose errors reach Drizzle's query path.)
  const connect = created.connect.bind(created) as (...args: unknown[]) => unknown;
  created.connect = ((...args: unknown[]) =>
    args.length > 0
      ? connect(...args)
      : (connect() as Promise<unknown>).catch((error: unknown) => {
          throw sanitizeConnectionError(error);
        })) as Pool["connect"];
  pool = created;
  return pool;
}

/**
 * Connection-owner access. Use only for authentication and system work that runs before a tenant
 * is known. All practice data goes through `withTenant` (src/db/tenant.ts).
 */
export function systemDb(): Database {
  // Every query error, system or tenant, is stripped of params and row values (src/db/errors.ts).
  installQueryErrorSanitizer();
  database ??= drizzle(getPool(), { schema });
  return database;
}

/** Round-trips a trivial query. Used by the health check. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await systemDb().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

/** For scripts and tests that must release the pool to exit. */
export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = undefined;
  database = undefined;
}
