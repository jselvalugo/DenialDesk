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
import { auditEvents, memberships, sessions, users } from "@/db/schema";
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
  it("is on only with an email and a well-formed scrypt hash", async () => {
    const hash = await hashPassword("a synthetic operator passphrase");
    configure(email(), hash);
    expect(operatorConfigured()).toBe(true);
    expect(configuredOperatorHash()).toBe(hash);
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", "not-a-hash");
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
    await syncOperatorAccount();
    const user = await byEmail(address);
    expect(user).toMatchObject({ passwordHash: hash, mfaEnrolledAt: null, mustChangePassword: false });
    expect(await verifyPassword("a synthetic operator passphrase", user!.passwordHash)).toBe(true);
    expect(await systemDb().select().from(memberships).where(eq(memberships.userId, user!.id))).toHaveLength(
      0,
    );
    expect(await lastEvent("operator.credential_provisioned", user!.id)).toBeDefined();

    // Nothing changed: no second write, no second event.
    await syncOperatorAccount();
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
    await syncOperatorAccount();
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
    await syncOperatorAccount();
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
      mfaReset: true,
      sessionsEnded: 1,
    });
  });

  it("never touches a practice account that shares the configured email (fail closed)", async () => {
    const practice = await createTestTenant("Practice whose admin shares the operator email");
    const member = (await systemDb().select().from(users).where(eq(users.id, practice.userId)))[0]!;
    configure(member.email, await hashPassword("a synthetic operator passphrase"));
    await syncOperatorAccount();
    const after = (await systemDb().select().from(users).where(eq(users.id, member.id)))[0]!;
    expect(after.passwordHash).toBe(member.passwordHash);
    expect(await isOperatorAccount(member)).toBe(false);
  });

  it("does nothing when the console isn't configured", async () => {
    const address = email();
    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", address);
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", "");
    await syncOperatorAccount();
    expect(await byEmail(address)).toBeUndefined();
  });
});

describe("isOperatorAccount", () => {
  it("is the configured email with no practice membership", async () => {
    const address = email();
    configure(address, await hashPassword("a synthetic operator passphrase"));
    await syncOperatorAccount();
    const user = (await byEmail(address))!;
    expect(await isOperatorAccount(user)).toBe(true);
    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", "");
    expect(await isOperatorAccount(user)).toBe(false);
  });
});
