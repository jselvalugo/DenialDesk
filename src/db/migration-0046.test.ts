import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// docs/specs/claims.md C3a: the 837P billing columns are added with no new table, no policy, and no
// privilege change (CLAUDE.md #5, R-15.9): `providers` and `locations` already carry the table-level grant
// from drizzle/0002_security.sql, which covers a column added later. A GRANT would need owner sign-off.

const sql = readFileSync("drizzle/0046_claim_837p_billing_data.sql", "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("migration 0046 (claims C3a billing columns)", () => {
  it("adds columns and shape checks only: no table, grant, revoke, policy, function, or trigger", () => {
    expect(statements).not.toMatch(
      /\b(GRANT|REVOKE|CREATE\s+TABLE|CREATE\s+POLICY|CREATE\s+FUNCTION|CREATE\s+TRIGGER|SECURITY\s+DEFINER|DROP|DELETE|UPDATE)\b/i,
    );
    const verbs = statements
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => /^ALTER TABLE "(\w+)" (ADD COLUMN|ADD CONSTRAINT)/.exec(s)?.slice(1).join(" "));
    expect(verbs.every((v) => v !== undefined)).toBe(true);
    expect(new Set(verbs.map((v) => v!.split(" ")[0]))).toEqual(new Set(["locations", "providers"]));
  });

  it("adds only nullable columns, so existing rows stay valid", () => {
    const columns = [...statements.matchAll(/ADD COLUMN "(\w+)" (\w+)( NOT NULL)?/g)];
    expect(columns.map((m) => m[1])).toEqual([
      "place_of_service",
      "first_name",
      "last_name",
      "address_line1",
      "city",
      "state",
      "postal_code",
      "tin_type",
      "tin_enc",
    ]);
    expect(columns.every((m) => m[3] === undefined)).toBe(true);
  });
});
