import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// SC-A4.1: every dependency is pinned to an exact version, and the lockfile agrees with package.json.
const manifest = JSON.parse(readFileSync("package.json", "utf8")) as Record<string, unknown>;
const lockfile = readFileSync("pnpm-lock.yaml", "utf8");
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
const pinned = sections.flatMap((section) =>
  Object.entries((manifest[section] ?? {}) as Record<string, string>).map(([name, version]) => ({
    section,
    name,
    version,
  })),
);

describe("dependency pins (SC-A4.1)", () => {
  it("lists dependencies to check", () => {
    expect(pinned.length).toBeGreaterThan(0);
  });

  for (const { section, name, version } of pinned) {
    it(`${section} ${name} is an exact version`, () => {
      expect(version, `${name}: use an exact version, no ^, ~, ranges, tags, or URLs`).toMatch(EXACT);
    });

    it(`${section} ${name} matches the lockfile specifier`, () => {
      const key = name.includes("@") || name.includes("/") ? `'${name}'` : name;
      expect(lockfile).toContain(`      ${key}:\n        specifier: ${version}\n`);
    });
  }
});
