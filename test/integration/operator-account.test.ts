import { afterAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { OperatorSetupError, setUpOperatorAccount } from "@/auth/operator-account";
import { verifyPassword } from "@/auth/password";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, memberships, sessions, users } from "@/db/schema";
import { createTestTenant } from "./helpers";

// Operator account setup and recovery (docs/specs/operator-login.md). Synthetic accounts only.

afterAll(() => closeDatabase());

const email = () => `operator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@synthetic.test`;

describe("setUpOperatorAccount", () => {
  it("creates an account that belongs to no practice, audited", async () => {
    const address = email();
    const { userId, created } = await setUpOperatorAccount({
      email: address,
      password: "first synthetic phrase",
    });
    expect(created).toBe(true);
    const [user] = await systemDb().select().from(users).where(eq(users.id, userId));
    expect(user).toMatchObject({ email: address, mustChangePassword: false, mfaEnrolledAt: null });
    expect(await verifyPassword("first synthetic phrase", user!.passwordHash)).toBe(true);
    expect(await systemDb().select().from(memberships).where(eq(memberships.userId, userId))).toHaveLength(0);
    const [event] = await systemDb()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "operator.setup_completed"), eq(auditEvents.entityId, userId)));
    expect(event?.metadata).toMatchObject({ created: true });
  });

  it("recovers an existing account: new password, two-step and lockout cleared, sessions ended", async () => {
    const address = email();
    const { userId } = await setUpOperatorAccount({ email: address, password: "first synthetic phrase" });
    await systemDb()
      .update(users)
      .set({
        totpSecretEnc: "x",
        mfaEnrolledAt: new Date(),
        totpLastStep: 5,
        failedLoginCount: 5,
        lockedUntil: new Date(Date.now() + 60_000),
      })
      .where(eq(users.id, userId));
    await systemDb()
      .insert(sessions)
      .values({
        tokenHash: `test-${userId}`,
        userId,
        authMethod: "operator",
        mfaVerified: true,
        expiresAt: new Date(Date.now() + 60_000),
      });

    const again = await setUpOperatorAccount({
      email: address.toUpperCase(),
      password: "second synthetic phrase",
    });
    expect(again).toEqual({ userId, created: false });
    const [user] = await systemDb().select().from(users).where(eq(users.id, userId));
    expect(user).toMatchObject({
      totpSecretEnc: null,
      mfaEnrolledAt: null,
      totpLastStep: null,
      failedLoginCount: 0,
      lockedUntil: null,
    });
    expect(await verifyPassword("second synthetic phrase", user!.passwordHash)).toBe(true);
    const live = await systemDb()
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    expect(live).toHaveLength(0);
  });

  it("refuses an email that belongs to a practice account", async () => {
    const practice = await createTestTenant("Practice with a would-be operator");
    const [member] = await systemDb().select().from(users).where(eq(users.id, practice.userId));
    await expect(
      setUpOperatorAccount({ email: member!.email, password: "a synthetic passphrase" }),
    ).rejects.toBeInstanceOf(OperatorSetupError);
    const [unchanged] = await systemDb().select().from(users).where(eq(users.id, practice.userId));
    expect(unchanged!.passwordHash).toBe(member!.passwordHash);
  });

  it("refuses a disabled account", async () => {
    const address = email();
    const { userId } = await setUpOperatorAccount({ email: address, password: "first synthetic phrase" });
    await systemDb().update(users).set({ disabledAt: new Date() }).where(eq(users.id, userId));
    await expect(
      setUpOperatorAccount({ email: address, password: "second synthetic phrase" }),
    ).rejects.toBeInstanceOf(OperatorSetupError);
  });

  it("is refused in production", async () => {
    const previous = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    try {
      await expect(
        setUpOperatorAccount({ email: email(), password: "a synthetic passphrase" }),
      ).rejects.toBeInstanceOf(OperatorSetupError);
    } finally {
      process.env.APP_ENV = previous;
    }
  });
});
