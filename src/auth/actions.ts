"use server";

import { redirect } from "next/navigation";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { auditSystem } from "@/lib/audit";
import { decryptField } from "@/lib/crypto/field";
import { decoyHash, verifyPassword } from "./password";
import { LOCKOUT_MS, MAX_FAILED_ATTEMPTS } from "./policy";
import { clientIp, completeMfa, createSession, endSession, getSession, touchSession } from "./session";
import { verifyTotp } from "./totp";

export interface FormState {
  error?: string;
}

// One message for wrong password, unknown account, and locked account, so responses never reveal
// which accounts exist (security review finding 3). Locked users are told how to recover.
const SIGN_IN_FAILED =
  "Email or password is incorrect, or the account is temporarily locked. Try again in 15 minutes or contact your administrator.";

/**
 * Reserves one sign-in attempt atomically before any credential is checked. Every password and
 * MFA attempt counts; only a completed sign-in (password + MFA) resets the counter. Because the
 * reservation and the lock happen in one UPDATE, parallel attempts can't exceed the limit and a
 * correct password can't reset the count between MFA guesses (security review findings 1–2).
 * Returns false when the account is locked.
 */
async function reserveAttempt(userId: string): Promise<boolean> {
  const result = await systemDb().execute<{ id: string; locked_now: boolean }>(sql`
    with counted as (
      select id, (case when locked_until <= now() then 0 else failed_login_count end) + 1 as attempts
      from users where id = ${userId} and (locked_until is null or locked_until <= now())
      for update
    )
    update users set
      failed_login_count = counted.attempts,
      locked_until = case when counted.attempts >= ${MAX_FAILED_ATTEMPTS}
        then now() + make_interval(secs => ${LOCKOUT_MS / 1000}) else null end
    from counted where users.id = counted.id
    returning users.id, counted.attempts >= ${MAX_FAILED_ATTEMPTS} as locked_now`);
  const row = result.rows[0];
  if (row?.locked_now) {
    await auditSystem({
      action: "auth.locked_out",
      actorUserId: userId,
      entityType: "user",
      entityId: userId,
    });
  }
  return row !== undefined;
}

async function recordFailure(userId: string, action: "auth.login_failed" | "auth.mfa_failed") {
  await auditSystem({
    action,
    actorUserId: userId,
    entityType: "user",
    entityId: userId,
    ipAddress: await clientIp(),
  });
}

const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
});

export async function signIn(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };

  const [user] = await systemDb()
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${parsed.data.email})`)
    .limit(1);

  if (!user || user.disabledAt) {
    await verifyPassword(parsed.data.password, await decoyHash()); // equal timing for unknown accounts
    await auditSystem({ action: "auth.login_failed", ipAddress: await clientIp() });
    return { error: SIGN_IN_FAILED };
  }
  if (!(await reserveAttempt(user.id))) {
    await verifyPassword(parsed.data.password, await decoyHash()); // equal timing while locked
    await auditSystem({ action: "auth.login_failed", actorUserId: user.id, metadata: { locked: true } });
    return { error: SIGN_IN_FAILED };
  }
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    await recordFailure(user.id, "auth.login_failed");
    return { error: SIGN_IN_FAILED };
  }

  // The attempt counter is deliberately NOT reset here: it resets only after MFA succeeds.
  await createSession(user.id);
  redirect(user.mfaEnrolledAt ? "/login/mfa" : "/login/mfa/setup");
}

const codeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});

/** Shared by sign-in MFA and first-time enrollment. */
async function checkCode(formData: FormData, enrolling: boolean): Promise<FormState> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mfaVerified) redirect("/");

  const parsed = codeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) return { error: "Enter the 6-digit code from your authenticator app." };

  const [user] = await systemDb().select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user?.totpSecretEnc || (enrolling ? user.mfaEnrolledAt !== null : user.mfaEnrolledAt === null)) {
    redirect("/login");
  }
  if (!(await reserveAttempt(user.id))) {
    await endSession(session.sessionId);
    redirect("/login?reason=locked");
  }

  const step = verifyTotp(decryptField(user.totpSecretEnc), parsed.data.code, user.totpLastStep);
  if (step === null) {
    await recordFailure(user.id, "auth.mfa_failed");
    return { error: "That code didn't match. Check your authenticator app and try again." };
  }

  // Claim the code's time step atomically so two simultaneous submissions of the same code can't
  // both succeed (single-use codes).
  const claimed = await systemDb()
    .update(users)
    .set({
      totpLastStep: step,
      failedLoginCount: 0,
      lockedUntil: null,
      ...(enrolling ? { mfaEnrolledAt: new Date() } : {}),
    })
    .where(and(eq(users.id, user.id), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
    .returning({ id: users.id });
  if (claimed.length === 0) {
    await recordFailure(user.id, "auth.mfa_failed");
    return { error: "That code was already used. Wait for the next code and try again." };
  }
  await completeMfa(session.sessionId);
  const ip = await clientIp();
  if (enrolling) {
    await auditSystem({
      action: "auth.mfa_enrolled",
      actorUserId: user.id,
      tenantId: session.tenantId,
      ipAddress: ip,
    });
  }
  await auditSystem({
    action: "auth.login_succeeded",
    actorUserId: user.id,
    tenantId: session.tenantId,
    ipAddress: ip,
  });
  redirect("/");
}

export async function verifyMfa(_: FormState, formData: FormData): Promise<FormState> {
  return checkCode(formData, false);
}

export async function confirmMfaEnrollment(_: FormState, formData: FormData): Promise<FormState> {
  return checkCode(formData, true);
}

export async function signOut(): Promise<void> {
  const session = await getSession();
  if (session) {
    await endSession(session.sessionId);
    await auditSystem({ action: "auth.logout", actorUserId: session.userId, tenantId: session.tenantId });
  }
  redirect("/login");
}

/** "Stay signed in" from the session-timeout warning. */
export async function keepSessionAlive(): Promise<boolean> {
  const session = await getSession();
  if (!session?.mfaVerified) return false;
  await touchSession(session.sessionId);
  return true;
}
