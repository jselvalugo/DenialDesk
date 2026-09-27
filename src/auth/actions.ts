"use server";

import { redirect } from "next/navigation";
import { LOCKOUT_MS } from "./policy";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemDb } from "@/db/client";
import { memberships, tenants, users } from "@/db/schema";
import { setLocaleCookie } from "@/i18n/cookie";
import { isLocale } from "@/i18n/config";
import type { MessageKey } from "@/i18n/messages/types";
import { getT } from "@/i18n/server";
import { auditSystem } from "@/lib/audit";
import { limitCurrentRequest } from "@/lib/rate-limit";
import {
  claimTotp,
  codeSchema,
  loginSchema,
  rateLimited,
  recordFailure,
  reserveAttempt,
  type FormState,
} from "./credentials";
import { isOperatorAccount } from "./operator-account";
import { decoyHash, hashPassword, passwordProblem, verifyPassword } from "./password";
import {
  clientIp,
  completeMfa,
  createSession,
  endSession,
  getSession,
  revokeSession,
  touchSession,
} from "./session";

export type { FormState };

/**
 * Ends the browser's current session, if any, before a new one replaces it (e.g. someone else's
 * half-finished sign-in on a shared computer). Runs only after a correct password, so a wrong one
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

export async function signIn(_: FormState, formData: FormData): Promise<FormState> {
  const t = await getT("auth");
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: t("error.enterEmailPassword") };
  const limited = await limitCurrentRequest("sign_in");
  if (!limited.allowed) return rateLimited("sign_in", limited);

  const [user] = await systemDb()
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${parsed.data.email})`)
    .limit(1);

  if (!user || user.disabledAt) {
    await verifyPassword(parsed.data.password, await decoyHash()); // equal timing for unknown accounts
    await auditSystem({ action: "auth.login_failed", ipAddress: await clientIp() });
    return { error: t("error.signInFailed", { minutes: LOCKOUT_MS / 60_000 }) };
  }
  // The platform operator signs in only at /operator/login; here it looks like any unknown account.
  // An account with a practice membership is never the operator, even if its email matches.
  if (await isOperatorAccount(user)) {
    await verifyPassword(parsed.data.password, await decoyHash());
    await auditSystem({
      action: "auth.login_failed",
      actorUserId: user.id,
      ipAddress: await clientIp(),
      metadata: { operatorAccount: true },
    });
    return { error: t("error.signInFailed", { minutes: LOCKOUT_MS / 60_000 }) };
  }
  if (!(await reserveAttempt(user.id))) {
    await verifyPassword(parsed.data.password, await decoyHash()); // equal timing while locked
    await auditSystem({
      action: "auth.login_failed",
      actorUserId: user.id,
      ipAddress: await clientIp(),
      metadata: { locked: true },
    });
    return { error: t("error.signInFailed", { minutes: LOCKOUT_MS / 60_000 }) };
  }
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    await recordFailure(user.id, "auth.login_failed");
    return { error: t("error.signInFailed", { minutes: LOCKOUT_MS / 60_000 }) };
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
    return { error: t("error.practiceSuspended") };
  }

  await replacePreviousSession(user.id);
  await createSession(user.id);
  // The language the account last chose follows the user to this browser (spec: internationalization).
  if (isLocale(user.locale)) await setLocaleCookie(user.locale);
  redirect(
    user.mustChangePassword ? "/login/password" : user.mfaEnrolledAt ? "/login/mfa" : "/login/mfa/setup",
  );
}

/** Shared by sign-in MFA and first-time enrollment. */
async function checkCode(formData: FormData, enrolling: boolean): Promise<FormState> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mfaVerified) redirect("/");

  const t = await getT("auth");
  const limited = await limitCurrentRequest("mfa");
  if (!limited.allowed) return rateLimited("mfa", limited);
  const parsed = codeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) return { error: t("error.enterCode") };

  const [user] = await systemDb().select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (user?.mustChangePassword) redirect("/login/password");
  if (!user?.totpSecretEnc || (enrolling ? user.mfaEnrolledAt !== null : user.mfaEnrolledAt === null)) {
    redirect("/login");
  }
  if (!(await reserveAttempt(user.id))) {
    await endSession(session.sessionId);
    redirect("/login?reason=locked");
  }

  const result = await claimTotp(
    { id: user.id, totpSecretEnc: user.totpSecretEnc, totpLastStep: user.totpLastStep },
    parsed.data.code,
    enrolling,
  );
  if (result !== "ok") {
    await recordFailure(user.id, "auth.mfa_failed");
    return { error: result === "mismatch" ? t("error.codeMismatch") : t("error.codeReused") };
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
  // A leftover demo session (the demo was removed) is never extended.
  if (!session?.mfaVerified || session.authMethod === "demo") return false;
  await touchSession(session.sessionId);
  return true;
}

const newPasswordSchema = z.object({ password: z.string().max(128), confirm: z.string().max(128) });

// passwordProblem() (./password.ts) returns one of these two fixed English sentences; mapped here
// to translated keys rather than changing that module's return value.
const PASSWORD_PROBLEM_KEYS: Record<string, MessageKey<"auth">> = {
  "Use at least 12 characters.": "error.passwordTooShort",
  "Use at most 128 characters.": "error.passwordTooLong",
};

/** Replaces an operator-issued temporary password before MFA setup. */
export async function setNewPassword(_: FormState, formData: FormData): Promise<FormState> {
  const session = await getSession();
  if (!session || session.mfaVerified) redirect("/login");
  const t = await getT("auth");
  const parsed = newPasswordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: t("error.enterConfirmPassword") };
  const problem = passwordProblem(parsed.data.password);
  if (problem) return { error: t(PASSWORD_PROBLEM_KEYS[problem] ?? "error.passwordTooShort") };
  if (parsed.data.password !== parsed.data.confirm) return { error: t("error.passwordsMismatch") };

  const [user] = await systemDb().select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user?.mustChangePassword) redirect("/login");
  if (await verifyPassword(parsed.data.password, user.passwordHash)) {
    return { error: t("error.passwordSameAsTemporary") };
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
