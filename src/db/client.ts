import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { serverEnv } from "@/lib/env";
import { netlifyDatabaseUrl } from "@/platform/netlify/database";
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
  pool ??= new Pool({
    connectionString: databaseUrl(),
    max: 10,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

/**
 * Connection-owner access. Use only for authentication and system work that runs before a tenant
 * is known. All practice data goes through `withTenant` (src/db/tenant.ts).
 */
export function systemDb(): Database {
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
