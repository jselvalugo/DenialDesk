import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { serverEnv } from "@/lib/env";

let pool: Pool | undefined;

function getPool(): Pool {
  pool ??= new Pool({
    connectionString: serverEnv().DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 3_000,
    idleTimeoutMillis: 30_000,
  });
  return pool;
}

export function db() {
  return drizzle(getPool());
}

/** Round-trips a trivial query. Used by the health check. */
export async function pingDatabase(): Promise<boolean> {
  try {
    await db().execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
