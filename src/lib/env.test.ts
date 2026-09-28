import { afterEach, describe, expect, it } from "vitest";
import { appEnv, isProduction, onNetlify, parseEnv, syntheticDataOnly } from "./env";

const valid = {
  APP_ENV: "development",
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};

describe("parseEnv", () => {
  it("accepts a valid environment", () => {
    expect(parseEnv(valid)).toEqual(valid);
  });

  it("rejects an unknown APP_ENV", () => {
    expect(() => parseEnv({ ...valid, APP_ENV: "staging" })).toThrow(/APP_ENV/);
  });

  it("allows DATABASE_URL to be omitted (Netlify supplies the database)", () => {
    expect(parseEnv({ ...valid, DATABASE_URL: undefined }).DATABASE_URL).toBeUndefined();
  });

  it("rejects a non-Postgres DATABASE_URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://u:p@localhost/db" })).toThrow(/DATABASE_URL/);
  });

  it("rejects an encryption key of the wrong length", () => {
    expect(() => parseEnv({ ...valid, FIELD_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(
      /FIELD_ENCRYPTION_KEY/,
    );
  });

  it("names missing variables without echoing any values", () => {
    const secret = "postgres://user:super-secret@localhost/db";
    try {
      parseEnv({ DATABASE_URL: secret });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("APP_ENV");
      expect((error as Error).message).not.toContain("super-secret");
    }
  });
});

// Security review PR #81, item 15: `onNetlify()`/`syntheticDataOnly()` are the last line of
// defense against a real-PHI feature unlocking on Netlify pre-production (ADR 0003) if APP_ENV
// were ever misconfigured there. These read `process.env` directly (not the cached `serverEnv()`),
// so each test restores every variable it touches.
describe("appEnv / isProduction / onNetlify / syntheticDataOnly", () => {
  const NETLIFY_VARS = ["NETLIFY", "NETLIFY_DB_URL", "DEPLOY_ID", "SITE_ID"] as const;
  const originalAppEnv = process.env.APP_ENV;
  const originalNetlifyVars = Object.fromEntries(NETLIFY_VARS.map((name) => [name, process.env[name]]));

  afterEach(() => {
    if (originalAppEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = originalAppEnv;
    for (const name of NETLIFY_VARS) {
      const value = originalNetlifyVars[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  function clearNetlifyVars(): void {
    for (const name of NETLIFY_VARS) delete process.env[name];
  }

  it("defaults APP_ENV to development when unset", () => {
    delete process.env.APP_ENV;
    expect(appEnv()).toBe("development");
    expect(isProduction()).toBe(false);
  });

  it("treats only APP_ENV=production as production", () => {
    process.env.APP_ENV = "preview";
    expect(isProduction()).toBe(false);
    process.env.APP_ENV = "production";
    expect(isProduction()).toBe(true);
  });

  it("reports onNetlify() from any of the platform-set variables", () => {
    clearNetlifyVars();
    expect(onNetlify()).toBe(false);
    process.env.NETLIFY = "true";
    expect(onNetlify()).toBe(true);
    clearNetlifyVars();
    process.env.DEPLOY_ID = "abc123";
    expect(onNetlify()).toBe(true);
  });

  it("syntheticDataOnly() is true off production", () => {
    clearNetlifyVars();
    process.env.APP_ENV = "development";
    expect(syntheticDataOnly()).toBe(true);
    process.env.APP_ENV = "preview";
    expect(syntheticDataOnly()).toBe(true);
  });

  it("syntheticDataOnly() is false in production off Netlify", () => {
    clearNetlifyVars();
    process.env.APP_ENV = "production";
    expect(syntheticDataOnly()).toBe(false);
  });

  it("APP_ENV=production on Netlify still forces synthetic-only (ADR 0003)", () => {
    process.env.APP_ENV = "production";
    process.env.NETLIFY = "true";
    expect(isProduction()).toBe(true);
    expect(onNetlify()).toBe(true);
    expect(syntheticDataOnly()).toBe(true);
  });
});
