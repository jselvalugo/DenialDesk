import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// SC-A2.6: no phone-home. Next.js telemetry is off wherever the app is built or run.
describe("build-tool phone-home is disabled (SC-A2.6)", () => {
  it("in CI, for every job", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const topLevelEnv = ci.match(/^env:\n((?: {2}.*\n)+)/m)?.[1] ?? "";
    expect(topLevelEnv).toMatch(/^ {2}NEXT_TELEMETRY_DISABLED: "1"$/m);
  });

  it("in local development (.env.example)", () => {
    expect(readFileSync(".env.example", "utf8")).toMatch(/^NEXT_TELEMETRY_DISABLED=1$/m);
  });

  it("in the container build and runtime stages", () => {
    const envLines = readFileSync("Dockerfile", "utf8").match(/^ENV .*$/gm) ?? [];
    expect(envLines.filter((line) => line.includes("NEXT_TELEMETRY_DISABLED=1"))).toHaveLength(2);
  });

  it("pnpm's update notifier is off, including in the image build", () => {
    expect(readFileSync(".npmrc", "utf8")).toMatch(/^update-notifier=false$/m);
    expect(readFileSync("Dockerfile", "utf8")).toMatch(/^COPY .*\.npmrc/m);
  });

  it("in Netlify builds", () => {
    expect(readFileSync("netlify.toml", "utf8")).toMatch(/^\s*NEXT_TELEMETRY_DISABLED = "1"$/m);
  });
});
