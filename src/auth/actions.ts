"use server";

import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
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

const GENERIC_FAILURE = "Email or password is incorrect.";
const LOCKED = "Too many attempts. Try again in 15 minutes or contact your administrator.";

/**
 * Counts a failed attempt atomically (concurrent attempts can't overwrite each other's count) and
 * locks the account once the limit is reached. Returns true when the account is now locked.
 */
async function recordFailure(userId: string, action: "auth.login_failed" | "auth.mfa_failed") {
  const result = await systemDb().execute<{ locked: boolean }>(sql`
    update users set
      failed_login_count = case when failed_login_count + 1 >= ${MAX_FAILED_ATTEMPTS} then 0 else failed_login_count + 1 end,
      locked_until = case when failed_login_count + 1 >= ${MAX_FAILED_ATTEMPTS}
        then now() + make_interval(secs => ${LOCKOUT_MS / 1000}) else locked_until end
    where id = ${userId}
    returning coalesce(locked_until > now(), false) as locked`);
  const locked = result.rows[0]?.locked === true;
  await auditSystem({
    action,
    actorUserId: userId,
    entityType: "user",
    entityId: userId,
    ipAddress: await clientIp(),
  });
  if (locked) {
    await auditSystem({
      action: "auth.locked_out",
      actorUserId: userId,
      entityType: "user",
      entityId: userId,
    });
  }
  return locked;
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
    return { error: GENERIC_FAILURE };
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    await auditSystem({ action: "auth.login_failed", actorUserId: user.id, metadata: { locked: true } });
    return { error: LOCKED };
  }
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    const locked = await recordFailure(user.id, "auth.login_failed");
    return { error: locked ? LOCKED : GENERIC_FAILURE };
  }

  await systemDb().update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, user.id));
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
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) return { error: LOCKED };

  const step = verifyTotp(decryptField(user.totpSecretEnc), parsed.data.code, user.totpLastStep);
  if (step === null) {
    const locked = await recordFailure(user.id, "auth.mfa_failed");
    if (locked) {
      await endSession(session.sessionId);
      return { error: LOCKED };
    }
    return { error: "That code didn't match. Check your authenticator app and try again." };
  }

  await systemDb()
    .update(users)
    .set({ totpLastStep: step, failedLoginCount: 0, ...(enrolling ? { mfaEnrolledAt: new Date() } : {}) })
    .where(eq(users.id, user.id));
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
