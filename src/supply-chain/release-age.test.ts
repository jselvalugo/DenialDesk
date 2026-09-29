import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// SC-A4.3: pnpm and Dependabot both hold a new release for at least 7 days.
const SEVEN_DAYS_IN_MINUTES = 7 * 24 * 60;

describe("release-age quarantine (SC-A4.3)", () => {
  it("pnpm refuses versions published less than 7 days ago", () => {
    const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
    const minutes = Number(workspace.match(/^minimumReleaseAge:\s*(\d+)\s*$/m)?.[1]);
    expect(minutes).toBeGreaterThanOrEqual(SEVEN_DAYS_IN_MINUTES);
  });

  it("the image build installs with the same pnpm settings", () => {
    expect(readFileSync("Dockerfile", "utf8")).toMatch(/^COPY .*pnpm-workspace\.yaml/m);
  });

  it("every Dependabot ecosystem has a cooldown of at least 7 days", () => {
    const config = readFileSync(".github/dependabot.yml", "utf8");
    const ecosystems = config.split(/^ {2}- package-ecosystem:/m).slice(1);
    expect(ecosystems.length).toBeGreaterThan(0);
    for (const block of ecosystems) {
      const name = block.split("\n")[0]?.trim();
      const days = Number(block.match(/^ {4}cooldown:\s*\n {6}default-days:\s*(\d+)\s*$/m)?.[1]);
      expect(days, `${name}: cooldown.default-days`).toBeGreaterThanOrEqual(7);
    }
  });
});
