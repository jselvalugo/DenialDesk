import { readFileSync } from "node:fs";
import { join } from "node:path";

// Netlify Database applies SQL from netlify/database/migrations/<number>_<slug>/migration.sql before
// each deploy is published. drizzle/ stays the source of truth (local, CI, Azure); this mirrors it.

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

export interface NetlifyMigration {
  directory: string;
  sql: string;
}

export function netlifyMigrations(root = process.cwd()): NetlifyMigration[] {
  const journal = JSON.parse(readFileSync(join(root, "drizzle/meta/_journal.json"), "utf8")) as Journal;
  return journal.entries
    .sort((a, b) => a.idx - b.idx)
    .map(({ tag }) => {
      const [number, ...rest] = tag.split("_");
      const slug = rest
        .join("-")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-");
      const source = readFileSync(join(root, "drizzle", `${tag}.sql`), "utf8");
      return {
        directory: `${number}_${slug}`,
        sql: `-- Generated from drizzle/${tag}.sql by \`pnpm netlify:migrations\`. Do not edit.\n${source}`,
      };
    });
}
