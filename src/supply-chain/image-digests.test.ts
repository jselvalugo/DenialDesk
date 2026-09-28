import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// SC-A4.2, SC-B12.3: container images are pinned by digest and pnpm is version- and hash-pinned.
const DIGEST = /@sha256:[0-9a-f]{64}$/;

function images(file: string, pattern: RegExp): string[] {
  return [...readFileSync(file, "utf8").matchAll(pattern)].map((match) => match[1] ?? "");
}

const dockerfileBases = images("Dockerfile", /^FROM\s+(\S+)/gm);
const ciImages = images(".github/workflows/ci.yml", /^\s+image:\s*(\S+)/gm);
const composeImages = images("docker-compose.yml", /^\s+image:\s*(\S+)/gm);

describe("image digests (SC-A4.2, SC-B12.3)", () => {
  it("finds the images to check", () => {
    expect(dockerfileBases).toHaveLength(3);
    expect(ciImages.length).toBeGreaterThan(0);
    expect(composeImages.length).toBeGreaterThan(0);
  });

  for (const [file, list] of [
    ["Dockerfile", dockerfileBases],
    ["ci.yml", ciImages],
    ["docker-compose.yml", composeImages],
  ] as const) {
    it(`${file} pins every image by digest`, () => {
      for (const image of list) expect(image).toMatch(DIGEST);
    });
  }

  it("every build stage uses the same base image", () => {
    expect(new Set(dockerfileBases).size).toBe(1);
  });

  it("CI tests against the database image local development uses", () => {
    expect(new Set([...ciImages, ...composeImages]).size).toBe(1);
  });
});

describe("pnpm pin (SC-A4.2)", () => {
  it("packageManager names an exact pnpm version and its sha512, which corepack verifies", () => {
    const { packageManager } = JSON.parse(readFileSync("package.json", "utf8")) as {
      packageManager?: string;
    };
    expect(packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+\+sha512\.[0-9a-f]{128}$/);
  });
});
