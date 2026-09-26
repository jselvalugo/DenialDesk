import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OPERATOR_SESSION_COOKIE, SESSION_COOKIE } from "@/auth/policy";
import { closeDatabase, systemDb } from "@/db/client";
import { sessions } from "@/db/schema";
import { createTestTenant } from "./helpers";

// Realm separation (docs/specs/operator-login.md): a session token only works in its own cookie.
// Runs the real session reader against the database; only the cookie jar is faked.

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  }),
  headers: async () => new Headers(),
}));

const { getOperatorSession, getSession } = await import("@/auth/session");

const tokens: Record<"password_mfa" | "demo" | "operator", string> = {
  password_mfa: "",
  demo: "",
  operator: "",
};

beforeAll(async () => {
  const practice = await createTestTenant("Realm separation practice");
  for (const authMethod of ["password_mfa", "demo", "operator"] as const) {
    const token = randomBytes(32).toString("base64url");
    tokens[authMethod] = token;
    await systemDb()
      .insert(sessions)
      .values({
        tokenHash: createHash("sha256").update(token).digest("hex"),
        userId: practice.userId,
        tenantId: authMethod === "operator" ? null : practice.tenantId,
        mfaVerified: true,
        authMethod,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
  }
});

beforeEach(() => jar.clear());
afterAll(() => closeDatabase());

describe("session realms", () => {
  it("reads each session from its own cookie", async () => {
    jar.set(SESSION_COOKIE, tokens.password_mfa);
    expect((await getSession())?.authMethod).toBe("password_mfa");
    jar.set(SESSION_COOKIE, tokens.demo);
    expect((await getSession())?.authMethod).toBe("demo");
    jar.clear();
    jar.set(OPERATOR_SESSION_COOKIE, tokens.operator);
    expect((await getOperatorSession())?.authMethod).toBe("operator");
  });

  it("rejects an operator token presented in the practice cookie", async () => {
    jar.set(SESSION_COOKIE, tokens.operator);
    expect(await getSession()).toBeNull();
  });

  it("rejects practice and demo tokens presented in the operator cookie", async () => {
    jar.set(OPERATOR_SESSION_COOKIE, tokens.password_mfa);
    expect(await getOperatorSession()).toBeNull();
    jar.set(OPERATOR_SESSION_COOKIE, tokens.demo);
    expect(await getOperatorSession()).toBeNull();
  });
});
