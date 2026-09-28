import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Production refuses to start integrations with an environment signing key present (spec PI2a "Keys",
// R-7.3.5): `register()` is the boot hook, so throwing there fails the boot.

const auditSystem = vi.fn(async () => undefined);
const logError = vi.fn();
vi.mock("@/lib/audit", () => ({ auditSystem }));
vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  log: { error: logError, info: vi.fn(), warn: vi.fn() },
}));

const KEY_VALUE = "-----BEGIN PRIVATE KEY-----\nSECRET-BYTES\n-----END PRIVATE KEY-----";

beforeEach(() => {
  vi.resetModules();
  auditSystem.mockClear();
  logError.mockClear();
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("FIELD_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  for (const name of ["NETLIFY", "NETLIFY_DB_URL", "DEPLOY_ID", "SITE_ID"]) vi.stubEnv(name, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function boot() {
  const { register } = await import("./instrumentation");
  return register();
}

describe("register(): the integration signing key at boot (L4)", () => {
  it("refuses to boot in production (outside Netlify) when INTEGRATION_SIGNING_KEY is set", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("INTEGRATION_SIGNING_KEY", KEY_VALUE);
    await expect(boot()).rejects.toThrow(/refuse to start/);
  });

  it("emits a security event and a log line for it, neither carrying the key", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("INTEGRATION_SIGNING_KEY", KEY_VALUE);
    await boot().catch(() => undefined);
    expect(auditSystem).toHaveBeenCalledWith({
      action: "security.env_signing_key_in_production",
      reason: "startup",
    });
    expect(logError).toHaveBeenCalledWith("integrations.env_signing_key_in_production");
    expect(JSON.stringify([auditSystem.mock.calls, logError.mock.calls])).not.toContain("SECRET-BYTES");
  });

  it("still refuses when the audit write fails (the database may not be up yet at boot)", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("INTEGRATION_SIGNING_KEY", KEY_VALUE);
    auditSystem.mockRejectedValueOnce(new Error("no database"));
    await expect(boot()).rejects.toThrow(/refuse to start/);
  });

  it("boots in production when the variable is absent or blank", async () => {
    vi.stubEnv("APP_ENV", "production");
    for (const value of ["", "  "]) {
      vi.stubEnv("INTEGRATION_SIGNING_KEY", value);
      await expect(boot()).resolves.toBeUndefined();
    }
    expect(auditSystem).not.toHaveBeenCalled();
  });

  it("boots on Netlify even with APP_ENV=production, where the key is the pre-production secret", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("INTEGRATION_SIGNING_KEY", KEY_VALUE);
    await expect(boot()).resolves.toBeUndefined();
  });

  it("boots outside production with the key set (local, CI, preview)", async () => {
    vi.stubEnv("APP_ENV", "preview");
    vi.stubEnv("INTEGRATION_SIGNING_KEY", KEY_VALUE);
    await expect(boot()).resolves.toBeUndefined();
  });

  it("does nothing in the Edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("INTEGRATION_SIGNING_KEY", KEY_VALUE);
    await expect(boot()).resolves.toBeUndefined();
  });
});
