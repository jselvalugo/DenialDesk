import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { netlifyMigrations } from "./migrations";

describe("Netlify Database migrations", () => {
  it("mirror drizzle/ exactly (run `pnpm netlify:migrations` after generating a migration)", () => {
    const expected = netlifyMigrations();
    const onDisk = readdirSync("netlify/database/migrations").sort();
    expect(onDisk).toEqual(expected.map((m) => m.directory));
    for (const migration of expected) {
      const file = `netlify/database/migrations/${migration.directory}/migration.sql`;
      expect(existsSync(file), file).toBe(true);
      expect(readFileSync(file, "utf8"), file).toBe(migration.sql);
    }
  });

  it("use directory names Netlify accepts", () => {
    for (const { directory } of netlifyMigrations()) expect(directory).toMatch(/^\d+_[a-z0-9-]+$/);
  });
});
