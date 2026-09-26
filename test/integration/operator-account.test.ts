import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  configuredOperatorHash,
  isOperatorAccount,
  operatorConfigured,
  syncOperatorAccount,
} from "@/auth/operator-account";
import { hashPassword, verifyPassword } from "@/auth/password";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, memberships, operatorCredentials, sessions, users } from "@/db/schema";
import { E2E_OPERATOR_PASSWORD_HASH } from "../e2e/operator-credentials";
import { createTestTenant } from "./helpers";

// The operator account exists only as provisioned from infrastructure configuration
// (docs/specs/operator-login.md). Synthetic accounts only.

afterAll(() => closeDatabase());
afterEach(() => vi.unstubAllEnvs());

const email = () => `operator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@synthetic.test`;
const byEmail = async (address: string) =>
  (await systemDb().select().from(users).where(eq(users.email, address.toLowerCase())))[0];
const lastEvent = async (action: string, userId: string) =>
  (
    await systemDb()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, action), eq(auditEvents.entityId, userId)))
      .orderBy(desc(auditEvents.id))
      .limit(1)
  )[0];

function configure(address: string, hash: string) {
  vi.stubEnv("PLATFORM_OPERATOR_EMAIL", address);
  vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", hash);
}

describe("operator configuration", () => {
  it("is on only with an email and a scrypt hash with exactly the expected parameters", async () => {
    const hash = await hashPassword("a synthetic operator passphrase");
    configure(email(), hash);
    expect(operatorConfigured()).toBe(true);
    expect(configuredOperatorHash()).toBe(hash);
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", "not-a-hash");
    expect(operatorConfigured()).toBe(false);
    // Weak or oversized cost parameters are refused, not just malformed strings.
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", hash.replace("scrypt$131072$", "scrypt$2$"));
    expect(operatorConfigured()).toBe(false);
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", `${hash}x`);
    expect(operatorConfigured()).toBe(false);
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", hash);
    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", "");
    expect(operatorConfigured()).toBe(false);
  });
});

describe("syncOperatorAccount", () => {
  it("provisions a practice-free account from configuration, audited", async () => {
    const address = email();
    const hash = await hashPassword("a synthetic operator passphrase");
    configure(address.toUpperCase(), hash);
    await syncOperatorAccount("console_request");
    const user = await byEmail(address);
    expect(user).toMatchObject({ passwordHash: hash, mfaEnrolledAt: null, mustChangePassword: false });
    expect(await verifyPassword("a synthetic operator passphrase", user!.passwordHash)).toBe(true);
    expect(await systemDb().select().from(memberships).where(eq(memberships.userId, user!.id))).toHaveLength(
      0,
    );
    const provisioned = await lastEvent("operator.credential_provisioned", user!.id);
    // Hosting configuration made the change, not the operator: no user actor.
    expect(provisioned).toMatchObject({ actorUserId: null });
    expect(provisioned?.metadata).toMatchObject({ source: "hosting_config", trigger: "console_request" });

    // Nothing changed: no second write, no second event.
    await syncOperatorAccount("console_request");
    const events = await systemDb()
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.action, "operator.credential_provisioned"), eq(auditEvents.entityId, user!.id)),
      );
    expect(events).toHaveLength(1);
  });

  it("applies a rotated hash: two-step and lockout cleared, every session ended, audited", async () => {
    const address = email();
    configure(address, await hashPassword("first synthetic operator phrase"));
    await syncOperatorAccount("console_request");
    const user = (await byEmail(address))!;
    await systemDb()
      .update(users)
      .set({
        totpSecretEnc: "x",
        mfaEnrolledAt: new Date(),
        totpLastStep: 5,
        failedLoginCount: 5,
        lockedUntil: new Date(Date.now() + 60_000),
      })
      .where(eq(users.id, user.id));
    await systemDb()
      .insert(sessions)
      .values({
        tokenHash: `test-${user.id}`,
        userId: user.id,
        authMethod: "operator",
        mfaVerified: true,
        expiresAt: new Date(Date.now() + 60_000),
      });

    const rotated = await hashPassword("second synthetic operator phrase");
    configure(address, rotated);
    await syncOperatorAccount("console_request");
    const after = (await byEmail(address))!;
    expect(after).toMatchObject({
      passwordHash: rotated,
      totpSecretEnc: null,
      mfaEnrolledAt: null,
      totpLastStep: null,
      failedLoginCount: 0,
      lockedUntil: null,
    });
    const live = await systemDb()
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
    expect(live).toHaveLength(0);
    expect((await lastEvent("operator.credential_rotated", user.id))?.metadata).toMatchObject({
      source: "hosting_config",
      mfaReset: true,
      sessionsEnded: 1,
    });
  });

  it("only moves forward: a deployment still carrying a retired hash can never re-apply it", async () => {
    const address = email();
    const first = await hashPassword("first synthetic operator phrase");
    const second = await hashPassword("second synthetic operator phrase");
    configure(address, first);
    expect(await syncOperatorAccount("console_request")).toBe("provisioned");
    configure(address, second);
    expect(await syncOperatorAccount("console_request")).toBe("rotated");
    const user = (await byEmail(address))!;
    await systemDb()
      .update(users)
      .set({ mfaEnrolledAt: new Date(), totpSecretEnc: "x" })
      .where(eq(users.id, user.id));

    // An old deploy link still configured with the first hash.
    configure(address, first);
    expect(await syncOperatorAccount("sign_in")).toBe("retired");
    const after = (await byEmail(address))!;
    expect(after.passwordHash).toBe(second);
    expect(after.mfaEnrolledAt).not.toBeNull();
    // And the current configuration keeps working.
    configure(address, second);
    expect(await syncOperatorAccount("sign_in")).toBe("current");
  });

  it("retires the previous operator account when the operator email changes", async () => {
    const oldAddress = email();
    const oldHash = await hashPassword("old synthetic operator phrase");
    configure(oldAddress, oldHash);
    await syncOperatorAccount("console_request");
    configure(email(), await hashPassword("new synthetic operator phrase"));
    expect(await syncOperatorAccount("console_request")).toBe("provisioned");
    // An old deploy link still configured with the previous email and hash.
    configure(oldAddress, oldHash);
    expect(await syncOperatorAccount("sign_in")).toBe("retired");
  });

  it("adopts a matching account that predates credential records only if nothing else is active", async () => {
    await systemDb()
      .update(operatorCredentials)
      .set({ retiredAt: new Date() })
      .where(isNull(operatorCredentials.retiredAt));
    const legacy = email();
    const hash = await hashPassword("legacy synthetic operator phrase");
    await systemDb()
      .insert(users)
      .values({ email: legacy, displayName: "Platform operator", passwordHash: hash });
    configure(legacy, hash);
    expect(await syncOperatorAccount("sign_in")).toBe("current");
    expect(await syncOperatorAccount("sign_in")).toBe("current");

    // Another legacy account while a credential is active: stale, never adopted.
    const other = email();
    const otherHash = await hashPassword("other synthetic operator phrase");
    await systemDb()
      .insert(users)
      .values({ email: other, displayName: "Platform operator", passwordHash: otherHash });
    configure(other, otherHash);
    expect(await syncOperatorAccount("sign_in")).toBe("retired");
  });

  it("applies a new configuration exactly once under concurrent requests", async () => {
    const address = email();
    configure(address, await hashPassword("first synthetic operator phrase"));
    const created = await Promise.all([1, 2, 3].map(() => syncOperatorAccount("sign_in")));
    expect(created.filter((r) => r === "provisioned")).toHaveLength(1);
    const user = (await byEmail(address))!;

    configure(address, await hashPassword("second synthetic operator phrase"));
    const rotated = await Promise.all([1, 2, 3].map(() => syncOperatorAccount("sign_in")));
    expect(rotated.filter((r) => r === "rotated")).toHaveLength(1);
    const events = await systemDb()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "operator.credential_rotated"), eq(auditEvents.entityId, user.id)));
    expect(events).toHaveLength(1);
  });

  it("never touches a disabled account, and records the refusal once per configuration", async () => {
    const address = email();
    configure(address, await hashPassword("first synthetic operator phrase"));
    await syncOperatorAccount("console_request");
    const user = (await byEmail(address))!;
    await systemDb().update(users).set({ disabledAt: new Date() }).where(eq(users.id, user.id));
    configure(address, await hashPassword("second synthetic operator phrase"));
    expect(await syncOperatorAccount("sign_in")).toBe("refused");
    expect(await syncOperatorAccount("sign_in")).toBe("refused");
    expect((await byEmail(address))!.passwordHash).toBe(user.passwordHash);
    const refusals = await systemDb()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "operator.credential_refused"), eq(auditEvents.entityId, user.id)));
    expect(refusals).toHaveLength(1);
    expect(refusals[0]!.metadata).toMatchObject({ reason: "disabled" });
  });

  it("refuses the public e2e test hash on Netlify and in production", async () => {
    configure(email(), E2E_OPERATOR_PASSWORD_HASH);
    expect(operatorConfigured()).toBe(true); // a local test server
    vi.stubEnv("NETLIFY", "true");
    expect(operatorConfigured()).toBe(false);
    vi.stubEnv("NETLIFY", "");
    vi.stubEnv("APP_ENV", "production");
    expect(operatorConfigured()).toBe(false);
  });

  it("never touches a practice account that shares the configured email (fail closed)", async () => {
    const practice = await createTestTenant("Practice whose admin shares the operator email");
    const member = (await systemDb().select().from(users).where(eq(users.id, practice.userId)))[0]!;
    configure(member.email, await hashPassword("a synthetic operator passphrase"));
    expect(await syncOperatorAccount("console_request")).toBe("refused");
    const after = (await systemDb().select().from(users).where(eq(users.id, member.id)))[0]!;
    expect(after.passwordHash).toBe(member.passwordHash);
    expect(await isOperatorAccount(member)).toBe(false);
  });

  it("does nothing when the console isn't configured", async () => {
    const address = email();
    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", address);
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", "");
    expect(await syncOperatorAccount("console_request")).toBe("unconfigured");
    expect(await byEmail(address)).toBeUndefined();
  });
});

describe("isOperatorAccount", () => {
  it("is the configured email with no practice membership", async () => {
    const address = email();
    configure(address, await hashPassword("a synthetic operator passphrase"));
    await syncOperatorAccount("console_request");
    const user = (await byEmail(address))!;
    expect(await isOperatorAccount(user)).toBe(true);
    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", "");
    expect(await isOperatorAccount(user)).toBe(false);
  });
});
