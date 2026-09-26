import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "@/auth/password";
import { closeDatabase } from "@/db/client";

// Operator sign-in refuses unless the console is configured (docs/specs/operator-login.md).
// Runs the real server action against the database; only cookies, headers and redirect are faked.

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));
// The real field allow-list still runs; only the write to stderr is replaced.
vi.mock("@/lib/log", async () => {
  const { buildLogRecord } = await vi.importActual<typeof import("@/lib/log")>("@/lib/log");
  const capture = (level: "debug" | "info" | "warn" | "error") =>
    vi.fn((event: string, fields?: Record<string, string | number | boolean>) => {
      buildLogRecord(level, event, fields);
    });
  return {
    log: { debug: capture("debug"), info: capture("info"), warn: capture("warn"), error: capture("error") },
  };
});

const { signInOperator } = await import("@/auth/operator-actions");
const { SIGN_IN_FAILED } = await import("@/auth/credentials");
const { log } = await import("@/lib/log");

afterAll(() => closeDatabase());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(log.warn).mockClear();
});
const refusals = () =>
  vi
    .mocked(log.warn)
    .mock.calls.filter(([event]) => event === "operator.sign_in_refused")
    .map(([, fields]) => fields?.status);

const password = "a synthetic operator passphrase";
let email: string;
let hash: string;
const form = (address: string, secret = password) => {
  const data = new FormData();
  data.set("email", address);
  data.set("password", secret);
  return data;
};

beforeEach(async () => {
  email = `operator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@synthetic.test`;
  hash ??= await hashPassword(password);
  // A generous limit so this file's attempts never trip the per-network sign-in limit.
  vi.stubEnv("RATE_LIMIT_SIGNIN", "1000");
});

describe("signInOperator", () => {
  it("signs in the configured operator (continues to two-step setup)", async () => {
    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", email);
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", hash);
    await expect(signInOperator({}, form(email))).rejects.toThrow("redirect:/operator/login/mfa/setup");
  });

  it("refuses with the generic error when the hash is missing or malformed", async () => {
    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", email);
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", hash);
    await expect(signInOperator({}, form(email))).rejects.toThrow("redirect:");
    for (const value of ["", "scrypt$broken"]) {
      vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", value);
      expect(await signInOperator({}, form(email))).toEqual({ error: SIGN_IN_FAILED });
    }
    expect(refusals()).toEqual(["hash_missing", "hash_malformed"]);
  });

  it("tells the operator (in the server log only) why each refusal happened, with fixed words", async () => {
    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", email);
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", hash);
    expect(await signInOperator({}, form(`other-${email}`))).toEqual({ error: SIGN_IN_FAILED });
    expect(await signInOperator({}, form(email, "not the synthetic passphrase"))).toEqual({
      error: SIGN_IN_FAILED,
    });
    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", "");
    expect(await signInOperator({}, form(email))).toEqual({ error: SIGN_IN_FAILED });
    expect(refusals()).toEqual(["unknown_email", "wrong_password", "email_missing"]);
    // Nothing from the attempt or the configuration reaches the log line.
    const logged = JSON.stringify(vi.mocked(log.warn).mock.calls);
    expect(logged).not.toContain(email);
    expect(logged).not.toContain(hash.slice(-20));
  });
});
