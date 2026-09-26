import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { E2E_OPERATOR_PASSWORD_HASH } from "../../test/e2e/operator-credentials";

vi.mock("@/db/client", () => ({ systemDb: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
// The real field allow-list still runs (a rejected field would throw and break every console
// request), only the write to stderr is replaced.
vi.mock("@/lib/log", async () => {
  const actual = await vi.importActual<typeof import("@/lib/log")>("@/lib/log");
  const { buildLogRecord } = actual;
  const capture = (level: "debug" | "info" | "warn" | "error") =>
    vi.fn((event: string, fields?: Record<string, string | number | boolean>) => {
      buildLogRecord(level, event, fields);
    });
  return {
    ...actual,
    log: { debug: capture("debug"), info: capture("info"), warn: capture("warn"), error: capture("error") },
  };
});

const { configuredOperatorHash, operatorConfigured } = await import("./operator-account");
const { hashPassword } = await import("./password");
const { log } = await import("@/lib/log");

// The hosting configuration holds the hash `pnpm operator:credential` prints, never the password.
// Anything else switches the console off, and the operator learns why from one log line.
describe("configuredOperatorHash", () => {
  beforeEach(() => {
    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", "operator@synthetic.test");
    vi.mocked(log.warn).mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the hash pnpm operator:credential prints, without warning", async () => {
    const hash = await hashPassword("a synthetic operator passphrase");
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", ` ${hash}\n`);
    expect(configuredOperatorHash()).toBe(hash);
    expect(operatorConfigured()).toBe(true);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("warns once per value, logging nothing derived from it, when the value is the password itself", () => {
    const password = "Synthetic-Not-A-Hash-2026!";
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", password);
    expect(configuredOperatorHash()).toBeNull();
    expect(operatorConfigured()).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
    // Exactly the status: a malformed value may be the password, so not even a digest of it is
    // logged (a short unsalted digest would still help offline guessing).
    expect(log.warn).toHaveBeenCalledWith("operator.credential_unusable", { status: "malformed" });
    const logged = JSON.stringify(vi.mocked(log.warn).mock.calls);
    expect(logged).not.toContain(password);
    expect(logged).not.toContain(createHash("sha256").update(password).digest("hex").slice(0, 8));

    // Every later request with the same value stays quiet; a different bad value warns again.
    configuredOperatorHash();
    expect(log.warn).toHaveBeenCalledTimes(1);
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", `${password}x`);
    configuredOperatorHash();
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it("treats a hash with other scrypt parameters as malformed", async () => {
    const hash = await hashPassword("a synthetic operator passphrase");
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", hash.replace("scrypt$131072$", "scrypt$16384$"));
    expect(configuredOperatorHash()).toBeNull();
    expect(log.warn).toHaveBeenCalledWith("operator.credential_unusable", { status: "malformed" });
  });

  it("warns when the public e2e test hash is configured on Netlify or in production", () => {
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", E2E_OPERATOR_PASSWORD_HASH);
    vi.stubEnv("NETLIFY", "true");
    expect(configuredOperatorHash()).toBeNull();
    expect(log.warn).toHaveBeenCalledWith("operator.credential_unusable", { status: "test_hash" });
    vi.stubEnv("NETLIFY", "");
    vi.stubEnv("APP_ENV", "production");
    expect(configuredOperatorHash()).toBeNull();
  });

  it("accepts the public e2e test hash on a local test server, without warning", () => {
    vi.stubEnv("NETLIFY", "");
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", E2E_OPERATOR_PASSWORD_HASH);
    expect(configuredOperatorHash()).toBe(E2E_OPERATOR_PASSWORD_HASH);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("is silent when nothing is configured", () => {
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", "");
    expect(configuredOperatorHash()).toBeNull();
    expect(log.warn).not.toHaveBeenCalled();
  });
});
