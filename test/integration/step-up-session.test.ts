import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { claimTotp, releaseAttempt, reserveAttempt, reserveStepUpAttempt } from "@/auth/credentials";
import { MFA_STEP_UP_WINDOW_MS, OPERATOR_SESSION_COOKIE, SESSION_COOKIE } from "@/auth/policy";
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

const { completeMfa, completeStepUpMfa, createSession, getSession, hasRecentMfa } =
  await import("@/auth/session");

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

describe("createSession and mfa_verified_at", () => {
  const stored = async (cookie: string) => {
    const [row] = await systemDb()
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, hash(jar.get(cookie)!)));
    return row!;
  };

  it("a practice session starts unverified, with no verification time", async () => {
    await createSession(practice.userId, { tenantId: practice.tenantId });
    const row = await stored(SESSION_COOKIE);
    expect(row.mfaVerified).toBe(false);
    expect(row.mfaVerifiedAt).toBeNull();
  });

  it("an operator session that skipped MFA (two-step switched off outside production) records the time it started", async () => {
    await createSession(practice.userId, { authMethod: "operator", mfaVerified: true });
    const row = await stored(OPERATOR_SESSION_COOKIE);
    expect(row.mfaVerified).toBe(true);
    expect(hasRecentMfa(row.mfaVerifiedAt)).toBe(true);
  });

  it("an operator session that hasn't done MFA has no verification time", async () => {
    await createSession(practice.userId, { authMethod: "operator" });
    const row = await stored(OPERATOR_SESSION_COOKIE);
    expect(row.mfaVerified).toBe(false);
    expect(row.mfaVerifiedAt).toBeNull();
  });
});

describe("completeStepUpMfa", () => {
  it("records a fresh verification and rotates the session token: the old one stops working", async () => {
    const { id, token: before } = await newSession({
      mfaVerified: true,
      mfaVerifiedAt: new Date(Date.now() - MFA_STEP_UP_WINDOW_MS - 60_000),
    });
    expect(hasRecentMfa((await getSession())!.mfaVerifiedAt)).toBe(false);

    expect(await completeStepUpMfa(id)).toBe(true);
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
    // No live row was updated: it says so (the caller must not audit a verification), sets no cookie.
    const cookieBefore = jar.get(SESSION_COOKIE);
    expect(await completeStepUpMfa(id)).toBe(false);
    expect(jar.get(SESSION_COOKIE)).toBe(cookieBefore);
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
    const step = currentStep();
    // More cycles than the lockout limit (5). The single-use rule is cleared between cycles only so
    // the same code can be presented again; without releaseAttempt the fifth would lock the account.
    for (let cycle = 0; cycle < 7; cycle += 1) {
      await systemDb().update(users).set({ totpLastStep: null }).where(eq(users.id, userId));
      expect(await reserveAttempt(userId)).toBe(true);
      expect(await claimTotp(await claimable(), totpAt(secret, step), false, false)).toBe("ok");
      await releaseAttempt(userId);
    }
    const after = await user();
    expect(after.failedLoginCount).toBe(0);
    expect(after.lockedUntil).toBeNull();
  });

  it("a step-up on 4 earlier failures is refused before any code is checked: it would reach the limit, and a correct code must not lock the account", async () => {
    await freshUser(4);
    expect(await reserveStepUpAttempt(userId)).toBe(false);
    const after = await user();
    // Nothing changed: no attempt was counted, and the account isn't locked.
    expect(after.failedLoginCount).toBe(4);
    expect(after.lockedUntil).toBeNull();
    // (Sign-in's own reservation, by contrast, counts the 5th attempt and locks after it.)
    expect(await reserveAttempt(userId)).toBe(true);
    expect((await user()).lockedUntil).not.toBeNull();
  });

  it("a step-up counts its attempt while below the limit, and never sets the lock itself", async () => {
    await freshUser(2);
    expect(await reserveStepUpAttempt(userId)).toBe(true);
    expect((await user()).failedLoginCount).toBe(3);
    expect(await reserveStepUpAttempt(userId)).toBe(true);
    expect((await user()).failedLoginCount).toBe(4);
    expect(await reserveStepUpAttempt(userId)).toBe(false);
    const after = await user();
    expect(after.failedLoginCount).toBe(4);
    expect(after.lockedUntil).toBeNull();
  });

  it("a step-up is refused while the account is locked, and starts over once the lock has expired", async () => {
    await freshUser(5);
    const until = new Date(Date.now() + 10 * 60_000);
    await systemDb().update(users).set({ lockedUntil: until }).where(eq(users.id, userId));
    expect(await reserveStepUpAttempt(userId)).toBe(false);
    expect((await user()).failedLoginCount).toBe(5);

    await systemDb()
      .update(users)
      .set({ lockedUntil: new Date(Date.now() - 1_000) })
      .where(eq(users.id, userId));
    expect(await reserveStepUpAttempt(userId)).toBe(true);
    const restarted = await user();
    expect(restarted.failedLoginCount).toBe(1);
    expect(restarted.lockedUntil).toBeNull();
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
