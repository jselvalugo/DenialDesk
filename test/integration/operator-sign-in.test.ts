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

const { signInOperator } = await import("@/auth/operator-actions");
const { SIGN_IN_FAILED } = await import("@/auth/credentials");

afterAll(() => closeDatabase());
afterEach(() => vi.unstubAllEnvs());

const password = "a synthetic operator passphrase";
let email: string;
let hash: string;
const form = (address: string) => {
  const data = new FormData();
  data.set("email", address);
  data.set("password", password);
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
  });
});
