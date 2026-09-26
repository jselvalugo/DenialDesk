"use server";

import { redirect } from "next/navigation";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { systemDb } from "@/db/client";
import { memberships, tenants, users } from "@/db/schema";
import { auditSystem } from "@/lib/audit";
import { limitCurrentRequest, retryMessage, type Bucket, type RateLimitResult } from "@/lib/rate-limit";
import { decryptField } from "@/lib/crypto/field";
import { decoyHash, hashPassword, passwordProblem, verifyPassword } from "./password";
import { LOCKOUT_MS, MAX_FAILED_ATTEMPTS } from "./policy";
import {
  clientIp,
  completeMfa,
  createSession,
  endSession,
  getSession,
  revokeSession,
  touchSession,
} from "./session";
import { verifyTotp } from "./totp";
import { ensureDemoPractice } from "./demo";
import { demoLoginEnabled } from "@/lib/env";

export interface FormState {
  error?: string;
}

async function rateLimited(bucket: Bucket, what: string, result: RateLimitResult): Promise<FormState> {
  await auditSystem({ action: "security.rate_limited", ipAddress: await clientIp(), metadata: { bucket } });
  return { error: retryMessage(what, result) };
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

/**
 * Ends the browser's current session, if any, before a new one replaces it (e.g. the owner signing
 * in from a browser that explored the demo). Runs only after a correct password, so a wrong one
 * never ends the existing session. Audited so every session has a recorded end.
 */
async function replacePreviousSession(actorUserId: string): Promise<void> {
  const previous = await getSession();
  if (!previous) return;
  await revokeSession(previous.sessionId);
  await auditSystem({
    action: "auth.session_replaced",
    actorUserId,
    tenantId: previous.tenantId,
    entityType: "session",
    entityId: previous.sessionId,
    ipAddress: await clientIp(),
    metadata: { previousUserId: previous.userId, previousAuthMethod: previous.authMethod },
  });
}

const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
});

export async function signIn(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };
  const limited = await limitCurrentRequest("sign_in");
  if (!limited.allowed) return rateLimited("sign_in", "sign-in attempts", limited);

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
  // Only someone with the right password learns that their practice is suspended.
  const practices = await systemDb()
    .select({ suspendedAt: tenants.suspendedAt })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.userId, user.id));
  if (practices.length > 0 && practices.every((p) => p.suspendedAt !== null)) {
    await auditSystem({ action: "auth.login_failed", actorUserId: user.id, metadata: { suspended: true } });
    return { error: "This practice's access is suspended. Contact DenialDesk support." };
  }

  await replacePreviousSession(user.id);
  await createSession(user.id);
  redirect(
    user.mustChangePassword ? "/login/password" : user.mfaEnrolledAt ? "/login/mfa" : "/login/mfa/setup",
  );
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

  const limited = await limitCurrentRequest("mfa");
  if (!limited.allowed) return rateLimited("mfa", "verification attempts", limited);
  const parsed = codeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) return { error: "Enter the 6-digit code from your authenticator app." };

  const [user] = await systemDb().select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (user?.mustChangePassword) redirect("/login/password");
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

/**
 * One-click demo sign-in (non-production only, DEMO_LOGIN_ENABLED=true). The only path that skips
 * MFA, and it can only reach the synthetic demo practice.
 */
export async function signInDemo(): Promise<FormState> {
  if (!demoLoginEnabled()) return { error: "The demo isn't available here." };
  const limited = await limitCurrentRequest("demo_login");
  if (!limited.allowed) return rateLimited("demo_login", "demo sessions", limited);
  const { tenantId, userId } = await ensureDemoPractice();
  await replacePreviousSession(userId);
  await createSession(userId, { authMethod: "demo", tenantId });
  await auditSystem({
    action: "auth.demo_login",
    actorUserId: userId,
    tenantId,
    ipAddress: await clientIp(),
  });
  redirect("/");
}

const newPasswordSchema = z.object({ password: z.string().max(128), confirm: z.string().max(128) });

/** Replaces an operator-issued temporary password before MFA setup. */
export async function setNewPassword(_: FormState, formData: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session || session.mfaVerified) redirect("/login");
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: "Enter and confirm your new password." };
  const problem = passwordProblem(parsed.data.password);
  if (problem) return { error: problem };
  if (parsed.data.password !== parsed.data.confirm) return { error: "The passwords don't match." };

  const [user] = await systemDb().select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user?.mustChangePassword) redirect("/login");
  if (await verifyPassword(parsed.data.password, user.passwordHash)) {
    return { error: "Choose a password different from the temporary one." };
  }
  await systemDb()
    .update(users)
    .set({ passwordHash: await hashPassword(parsed.data.password), mustChangePassword: false })
    .where(eq(users.id, user.id));
  await auditSystem({
    action: "auth.password_changed",
    actorUserId: user.id,
    entityType: "user",
    entityId: user.id,
  });
  redirect(user.mfaEnrolledAt ? "/login/mfa" : "/login/mfa/setup");
}
