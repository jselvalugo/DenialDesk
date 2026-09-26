// Regenerates netlify/database/migrations/ from drizzle/. Run after `pnpm db:generate`.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { netlifyMigrations } from "@/platform/netlify/migrations";

const target = "netlify/database/migrations";
rmSync(target, { recursive: true, force: true });
for (const migration of netlifyMigrations()) {
  mkdirSync(join(target, migration.directory), { recursive: true });
  writeFileSync(join(target, migration.directory, "migration.sql"), migration.sql);
}
process.stdout.write(`Wrote ${netlifyMigrations().length} migrations to ${target}\n`);
