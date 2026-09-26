import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { E2E_OPERATOR_PASSWORD_HASH } from "../../test/e2e/operator-credentials";

vi.mock("@/db/client", () => ({ systemDb: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/log", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

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

  it("warns once per value, never logging it, when the value is the password instead of its hash", () => {
    const password = "Synthetic-Not-A-Hash-2026!";
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", password);
    expect(configuredOperatorHash()).toBeNull();
    expect(operatorConfigured()).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      "operator.credential_unusable",
      expect.objectContaining({ status: "malformed" }),
    );
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain(password);

    // Every later request with the same value stays quiet; a different bad value warns again.
    configuredOperatorHash();
    expect(log.warn).toHaveBeenCalledTimes(1);
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", `${password}x`);
    configuredOperatorHash();
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it("warns when the public e2e test hash is configured on Netlify", () => {
    vi.stubEnv("NETLIFY", "true");
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", E2E_OPERATOR_PASSWORD_HASH);
    expect(configuredOperatorHash()).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(
      "operator.credential_unusable",
      expect.objectContaining({ status: "test_hash" }),
    );
  });

  it("is silent when nothing is configured", () => {
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", "");
    expect(configuredOperatorHash()).toBeNull();
    expect(log.warn).not.toHaveBeenCalled();
  });
});
