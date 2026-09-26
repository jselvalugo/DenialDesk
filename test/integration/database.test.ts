import { afterAll, describe, expect, it } from "vitest";
import { Client } from "pg";

// Requires DATABASE_URL pointing at a migrated database (docker compose locally, service container in CI).
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("Integration tests need DATABASE_URL. Run `docker compose up db` and `pnpm db:migrate`.");
}

const client = new Client({ connectionString: url });
await client.connect();
afterAll(() => client.end());

describe("database", () => {
  it("accepts connections", async () => {
    const result = await client.query<{ ok: number }>("select 1 as ok");
    expect(result.rows[0]?.ok).toBe(1);
  });

  it("has the baseline migration applied", async () => {
    const result = await client.query<{ count: string }>("select count(*) from drizzle.__drizzle_migrations");
    expect(Number(result.rows[0]?.count)).toBeGreaterThanOrEqual(1);
  });
});
