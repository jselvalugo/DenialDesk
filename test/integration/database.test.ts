import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";

afterAll(() => closeDatabase());

describe("database", () => {
  it("accepts connections", async () => {
    const result = await systemDb().execute<{ ok: number }>(sql`select 1 as ok`);
    expect(result.rows[0]?.ok).toBe(1);
  });

  it("has all migrations applied", async () => {
    const result = await systemDb().execute<{ count: string }>(
      sql`select count(*) from drizzle.__drizzle_migrations`,
    );
    expect(Number(result.rows[0]?.count)).toBeGreaterThanOrEqual(3);
  });
});
