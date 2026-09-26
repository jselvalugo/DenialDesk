import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/auth/password";
import { closeDatabase, systemDb } from "@/db/client";
import { memberships, users } from "@/db/schema";
import { E2E_OPERATOR_PASSWORD_HASH } from "../e2e/operator-credentials";
import { createTestTenant } from "./helpers";

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

  it("logs every other documented word: hash_test, other_email, disabled, practice_account, refused, locked, retired", async () => {
    const practice = await createTestTenant("Operator refusals");
    const [member] = await systemDb().select().from(users).where(eq(users.id, practice.userId));

    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", email);
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", E2E_OPERATOR_PASSWORD_HASH);
    vi.stubEnv("NETLIFY", "true");
    expect(await signInOperator({}, form(email))).toEqual({ error: SIGN_IN_FAILED });
    vi.stubEnv("NETLIFY", "");

    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", hash);
    // Provisions the operator; a practice user's email is "other", a disabled one is "disabled".
    expect(await signInOperator({}, form(member!.email))).toEqual({ error: SIGN_IN_FAILED });
    await systemDb().update(users).set({ disabledAt: new Date() }).where(eq(users.id, member!.id));
    expect(await signInOperator({}, form(member!.email))).toEqual({ error: SIGN_IN_FAILED });
    await systemDb().update(users).set({ disabledAt: null }).where(eq(users.id, member!.id));

    // The configured email belongs to a practice user: the sync refuses it (an existing practice
    // account is never touched), and so does sign-in with that email.
    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", member!.email);
    expect(await signInOperator({}, form(member!.email))).toEqual({ error: SIGN_IN_FAILED });
    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", email);

    // "practice_account": the operator's email while its account holds a membership, in a deployment
    // whose credential is still current (the sync's fast path never re-checks membership).
    const [operator] = await systemDb().select().from(users).where(eq(users.email, email));
    await systemDb()
      .insert(memberships)
      .values({ tenantId: practice.tenantId, userId: operator!.id, role: "specialist" });
    expect(await signInOperator({}, form(email))).toEqual({ error: SIGN_IN_FAILED });
    await systemDb().delete(memberships).where(eq(memberships.userId, operator!.id));

    // "locked": too many wrong attempts, in the sign-in's own lockout check.
    await systemDb()
      .update(users)
      .set({ lockedUntil: new Date(Date.now() + 60_000) })
      .where(eq(users.id, operator!.id));
    expect(await signInOperator({}, form(email))).toEqual({ error: SIGN_IN_FAILED });
    await systemDb().update(users).set({ lockedUntil: null }).where(eq(users.id, operator!.id));

    // A rotation retires this hash; a deployment still carrying it is refused.
    const rotated = await hashPassword("a second synthetic operator passphrase");
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", rotated);
    await expect(signInOperator({}, form(email, "a second synthetic operator passphrase"))).rejects.toThrow(
      "redirect:/operator/login/mfa/setup",
    );
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", hash);
    expect(await signInOperator({}, form(email))).toEqual({ error: SIGN_IN_FAILED });

    expect(refusals()).toEqual([
      "hash_test",
      "other_email",
      "disabled",
      "refused",
      "practice_account",
      "locked",
      "retired",
    ]);
  });
});
