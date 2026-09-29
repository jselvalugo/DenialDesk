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
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");

  it("packageManager names an exact pnpm version and its sha512", () => {
    const { packageManager } = JSON.parse(readFileSync("package.json", "utf8")) as {
      packageManager?: string;
    };
    expect(packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+\+sha512\.[0-9a-f]{128}$/);
  });

  it("CI gets pnpm from corepack, which checks the sha512, in every job that runs pnpm", () => {
    expect(ci).not.toMatch(/uses:\s*pnpm\/action-setup/);
    const jobs = ci.split(/^ {2}[a-z0-9-]+:\n {4}name:/m).slice(1);
    const pnpmJobs = jobs.filter((body) => /run: pnpm /.test(body));
    expect(pnpmJobs).toHaveLength(4);
    for (const job of pnpmJobs) {
      const install = job.indexOf("corepack enable && corepack install");
      expect(install).toBeGreaterThan(-1);
      expect(install).toBeLessThan(job.indexOf("run: pnpm "));
    }
  });
});

describe("runtime image (SC-B12.3)", () => {
  const runtime = readFileSync("Dockerfile", "utf8").split(/^FROM .* AS runtime$/m)[1] ?? "";

  it("removes the package managers the base image ships", () => {
    for (const path of [
      "node_modules/npm",
      "node_modules/corepack",
      "/opt/yarn-v*",
      "bin/yarn",
      "/sbin/apk",
    ]) {
      expect(runtime).toContain(path);
    }
  });

  it("deletes server source maps before the runtime stage copies the build", () => {
    expect(readFileSync("Dockerfile", "utf8")).toContain("find .next/standalone -name '*.map' -delete");
  });
});
