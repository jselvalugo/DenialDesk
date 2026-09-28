import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { claimTotp, releaseAttempt, reserveAttempt } from "@/auth/credentials";
import { MFA_STEP_UP_WINDOW_MS, SESSION_COOKIE } from "@/auth/policy";
import { currentStep, generateTotpSecret, totpAt } from "@/auth/totp";
import { closeDatabase, systemDb } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { encryptField } from "@/lib/crypto/field";
import { createTestTenant } from "./helpers";

// Step-up MFA (R-7.2.2; docs/specs/patient-integrations.md PI2a): the session records when MFA last
// completed, a step-up rotates the token, and a step-up shares the sign-in attempt counter without
// erasing earlier failures (and without adding up to a lockout across successful step-ups).

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const { completeMfa, completeStepUpMfa, getSession, hasRecentMfa } = await import("@/auth/session");

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

let practice: { tenantId: string; userId: string };
beforeAll(async () => {
  practice = await createTestTenant("Step-up sessions");
});
beforeEach(() => jar.clear());
afterAll(() => closeDatabase());

async function newSession(values: { mfaVerified: boolean; mfaVerifiedAt?: Date | null }) {
  const token = randomBytes(32).toString("base64url");
  const [row] = await systemDb()
    .insert(sessions)
    .values({
      tokenHash: hash(token),
      userId: practice.userId,
      tenantId: practice.tenantId,
      mfaVerified: values.mfaVerified,
      mfaVerifiedAt: values.mfaVerifiedAt ?? null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })
    .returning({ id: sessions.id });
  jar.set(SESSION_COOKIE, token);
  return { id: row!.id, token };
}

describe("sessions.mfa_verified_at", () => {
  it("is null on a session that predates the column, so it must step up before a gated action", async () => {
    await newSession({ mfaVerified: true });
    const session = await getSession();
    expect(session?.mfaVerified).toBe(true);
    expect(session?.mfaVerifiedAt).toBeNull();
    expect(hasRecentMfa(session!.mfaVerifiedAt)).toBe(false);
  });

  it("is recorded by the sign-in MFA step", async () => {
    const { id } = await newSession({ mfaVerified: false });
    await completeMfa(id);
    const session = await getSession();
    expect(session?.mfaVerified).toBe(true);
    expect(hasRecentMfa(session!.mfaVerifiedAt)).toBe(true);
  });

  it("goes stale after the step-up window", async () => {
    await newSession({
      mfaVerified: true,
      mfaVerifiedAt: new Date(Date.now() - MFA_STEP_UP_WINDOW_MS - 5_000),
    });
    expect(hasRecentMfa((await getSession())!.mfaVerifiedAt)).toBe(false);
  });
});

describe("completeStepUpMfa", () => {
  it("records a fresh verification and rotates the session token: the old one stops working", async () => {
    const { id, token: before } = await newSession({
      mfaVerified: true,
      mfaVerifiedAt: new Date(Date.now() - MFA_STEP_UP_WINDOW_MS - 60_000),
    });
    expect(hasRecentMfa((await getSession())!.mfaVerifiedAt)).toBe(false);

    await completeStepUpMfa(id);
    const after = jar.get(SESSION_COOKIE)!;
    expect(after).not.toBe(before);

    // The rotated token is the session, freshly verified, still fully signed in.
    const session = await getSession();
    expect(session?.sessionId).toBe(id);
    expect(session?.mfaVerified).toBe(true);
    expect(hasRecentMfa(session!.mfaVerifiedAt)).toBe(true);

    // The token the step-up was performed under no longer reads as a session.
    jar.set(SESSION_COOKIE, before);
    expect(await getSession()).toBeNull();
  });

  it("doesn't revive a session that was revoked", async () => {
    const { id } = await newSession({ mfaVerified: true });
    await systemDb().update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, id));
    await completeStepUpMfa(id);
    expect(await getSession()).toBeNull();
    const [row] = await systemDb().select().from(sessions).where(eq(sessions.id, id));
    expect(row!.mfaVerifiedAt).toBeNull();
  });
});

describe("the sign-in attempt counter under a step-up", () => {
  const secret = generateTotpSecret();
  let userId: string;

  async function freshUser(failed: number) {
    const ctx = await createTestTenant("Step-up counter");
    await systemDb()
      .update(users)
      .set({
        totpSecretEnc: encryptField(secret),
        mfaEnrolledAt: new Date(),
        totpLastStep: null,
        failedLoginCount: failed,
        lockedUntil: null,
      })
      .where(eq(users.id, ctx.userId));
    userId = ctx.userId;
    return ctx.userId;
  }

  async function user() {
    const [row] = await systemDb().select().from(users).where(eq(users.id, userId));
    return row!;
  }

  const claimable = async () => {
    const row = await user();
    return { id: row.id, totpSecretEnc: row.totpSecretEnc!, totpLastStep: row.totpLastStep };
  };

  it("sign-in's success still clears the counter (resetLockout defaults to true)", async () => {
    await freshUser(3);
    expect(await claimTotp(await claimable(), totpAt(secret, currentStep()), false)).toBe("ok");
    expect((await user()).failedLoginCount).toBe(0);
  });

  it("a step-up's success keeps the earlier failures, then gives back only its own attempt", async () => {
    await freshUser(2);
    expect(await reserveAttempt(userId)).toBe(true);
    expect((await user()).failedLoginCount).toBe(3);
    expect(await claimTotp(await claimable(), totpAt(secret, currentStep()), false, false)).toBe("ok");
    // Not reset to 0: the two earlier bad guesses still count...
    expect((await user()).failedLoginCount).toBe(3);
    await releaseAttempt(userId);
    // ...and only this step-up's own attempt came back.
    expect((await user()).failedLoginCount).toBe(2);
  });

  it("a wrong code at step-up leaves the counter raised (nothing gives the attempt back)", async () => {
    await freshUser(0);
    expect(await reserveAttempt(userId)).toBe(true);
    const wrong = totpAt(secret, currentStep() + 50);
    expect(await claimTotp(await claimable(), wrong, false, false)).toBe("mismatch");
    expect((await user()).failedLoginCount).toBe(1);
  });

  it("successful step-ups never add up to a lockout", async () => {
    await freshUser(0);
    // Three distinct steps are acceptable at once (now - 1, now, now + 1); more than the lockout
    // limit would need more, so repeat the reserve/claim/release cycle on the counter directly.
    const steps = [currentStep() - 1, currentStep(), currentStep() + 1];
    for (const step of steps) {
      expect(await reserveAttempt(userId)).toBe(true);
      expect(await claimTotp(await claimable(), totpAt(secret, step), false, false)).toBe("ok");
      await releaseAttempt(userId);
    }
    const after = await user();
    expect(after.failedLoginCount).toBe(0);
    expect(after.lockedUntil).toBeNull();
  });

  it("never goes below zero, and never unlocks a locked account", async () => {
    await freshUser(0);
    await releaseAttempt(userId);
    expect((await user()).failedLoginCount).toBe(0);
    const until = new Date(Date.now() + 10 * 60_000);
    await systemDb()
      .update(users)
      .set({ failedLoginCount: 5, lockedUntil: until })
      .where(eq(users.id, userId));
    await releaseAttempt(userId);
    const locked = await user();
    expect(locked.failedLoginCount).toBe(5);
    expect(locked.lockedUntil?.getTime()).toBe(until.getTime());
  });
});
