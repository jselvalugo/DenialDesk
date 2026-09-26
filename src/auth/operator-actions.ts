"use server";

import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { auditSystem } from "@/lib/audit";
import { limitCurrentRequest } from "@/lib/rate-limit";
import {
  claimTotp,
  CODE_MISMATCH,
  CODE_REUSED,
  codeSchema,
  loginSchema,
  rateLimited,
  recordFailure,
  reserveAttempt,
  SIGN_IN_FAILED,
  type FormState,
} from "./credentials";
import { log } from "@/lib/log";
import {
  isOperatorAccount,
  isOperatorEmail,
  operatorConfigurationStatus,
  syncOperatorAccount,
  usableSync,
  type SyncResult,
} from "./operator-account";
import { decoyHash, verifyPassword } from "./password";
import {
  clientIp,
  completeMfa,
  createSession,
  endSession,
  getOperatorSession,
  revokeSession,
  touchSession,
} from "./session";

// Platform console sign-in (docs/specs/operator-login.md). Same protections as practice sign-in
// (credentials.ts), but its own account, pages, session cookie, and audit events.

/**
 * Ends this browser's previous operator session, if any, before a new one replaces it. Audited so
 * every operator session has a recorded end.
 */
async function replacePreviousOperatorSession(actorUserId: string): Promise<void> {
  const previous = await getOperatorSession();
  if (!previous) return;
  await revokeSession(previous.sessionId);
  await auditSystem({
    action: "auth.session_replaced",
    actorUserId,
    entityType: "session",
    entityId: previous.sessionId,
    ipAddress: await clientIp(),
    metadata: { previousUserId: previous.userId, previousAuthMethod: previous.authMethod },
  });
}

/** The fixed words a refused operator sign-in is logged with (docs/specs/operator-login.md). */
export type RefusalStatus =
  | "email_missing"
  | "hash_missing"
  | "hash_malformed"
  | "hash_test"
  | "retired"
  | "refused"
  | "unknown_email"
  | "other_email"
  | "disabled"
  | "practice_account"
  | "locked"
  | "wrong_password";

/**
 * Why a sign-in was refused, for the operator alone (the server log; visitors see only the generic
 * error). `status` is a fixed word, never the email tried or anything from the configuration, so
 * the line can't help anyone guess the password or find out who the operator is.
 */
function refusalStatus(
  sync: SyncResult,
  user: { email: string; disabledAt: Date | null } | undefined,
): RefusalStatus {
  if (sync === "unconfigured") {
    const { email, passwordHash } = operatorConfigurationStatus();
    if (email === "missing") return "email_missing";
    if (passwordHash === "malformed") return "hash_malformed";
    if (passwordHash === "test_hash") return "hash_test";
    return "hash_missing";
  }
  if (sync === "retired" || sync === "refused") return sync;
  if (!user) return "unknown_email";
  if (user.disabledAt) return "disabled";
  return isOperatorEmail(user.email) ? "practice_account" : "other_email";
}

export async function signInOperator(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };
  const limited = await limitCurrentRequest("sign_in");
  if (!limited.allowed) return rateLimited("sign_in", "sign-in attempts", limited);

  // The operator account exists only as provisioned from infrastructure configuration.
  const sync = await syncOperatorAccount("sign_in");
  // Always look the account up, so response timing doesn't reveal which email is the operator's.
  const [user] = await systemDb()
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${parsed.data.email})`)
    .limit(1);
  // Every account but the operator (and a disabled or practice-linked one) looks unknown here.
  const isOperator =
    user !== undefined && !user.disabledAt && usableSync(sync) && (await isOperatorAccount(user));
  if (!user || !isOperator) {
    await verifyPassword(parsed.data.password, await decoyHash()); // equal timing
    await auditSystem({ action: "operator.login_failed", ipAddress: await clientIp() });
    log.warn("operator.sign_in_refused", { status: refusalStatus(sync, user) });
    return { error: SIGN_IN_FAILED };
  }
  if (!(await reserveAttempt(user.id))) {
    await verifyPassword(parsed.data.password, await decoyHash()); // equal timing while locked
    await auditSystem({
      action: "operator.login_failed",
      actorUserId: user.id,
      ipAddress: await clientIp(),
      metadata: { locked: true },
    });
    log.warn("operator.sign_in_refused", { status: "locked" });
    return { error: SIGN_IN_FAILED };
  }
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    await recordFailure(user.id, "operator.login_failed");
    log.warn("operator.sign_in_refused", { status: "wrong_password" });
    return { error: SIGN_IN_FAILED };
  }

  // The attempt counter resets only after MFA succeeds.
  await replacePreviousOperatorSession(user.id);
  await createSession(user.id, { authMethod: "operator" });
  redirect(user.mfaEnrolledAt ? "/operator/login/mfa" : "/operator/login/mfa/setup");
}

async function checkOperatorCode(formData: FormData, enrolling: boolean): Promise<FormState> {
  const session = await getOperatorSession();
  if (!session) redirect("/operator/login");
  if (session.mfaVerified) redirect("/operator");

  const limited = await limitCurrentRequest("mfa");
  if (!limited.allowed) return rateLimited("mfa", "verification attempts", limited);
  const parsed = codeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) return { error: "Enter the 6-digit code from your authenticator app." };

  const [user] = await systemDb().select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user?.totpSecretEnc || (enrolling ? user.mfaEnrolledAt !== null : user.mfaEnrolledAt === null)) {
    redirect("/operator/login");
  }
  if (!(await reserveAttempt(user.id))) {
    await auditSystem({
      action: "operator.mfa_failed",
      actorUserId: user.id,
      entityType: "session",
      entityId: session.sessionId,
      ipAddress: await clientIp(),
      metadata: { locked: true },
    });
    await endSession(session.sessionId, "operator");
    redirect("/operator/login?reason=locked");
  }
  const result = await claimTotp(
    { id: user.id, totpSecretEnc: user.totpSecretEnc, totpLastStep: user.totpLastStep },
    parsed.data.code,
    enrolling,
  );
  if (result !== "ok") {
    await recordFailure(user.id, "operator.mfa_failed");
    return { error: result === "mismatch" ? CODE_MISMATCH : CODE_REUSED };
  }
  await completeMfa(session.sessionId, "operator");
  const event = {
    actorUserId: user.id,
    entityType: "session",
    entityId: session.sessionId,
    ipAddress: await clientIp(),
  } as const;
  if (enrolling) await auditSystem({ action: "operator.mfa_enrolled", ...event });
  await auditSystem({ action: "operator.login_succeeded", ...event });
  redirect("/operator");
}

export async function verifyOperatorMfa(_: FormState, formData: FormData): Promise<FormState> {
  return checkOperatorCode(formData, false);
}

export async function confirmOperatorMfaEnrollment(_: FormState, formData: FormData): Promise<FormState> {
  return checkOperatorCode(formData, true);
}

export async function signOutOperator(): Promise<void> {
  const session = await getOperatorSession();
  if (session) {
    await endSession(session.sessionId, "operator");
    await auditSystem({
      action: "operator.logout",
      actorUserId: session.userId,
      entityType: "session",
      entityId: session.sessionId,
    });
  }
  redirect("/operator/login");
}

/** "Stay signed in" from the console's session-timeout warning. */
export async function keepOperatorSessionAlive(): Promise<boolean> {
  const session = await getOperatorSession();
  if (!session?.mfaVerified) return false;
  await touchSession(session.sessionId);
  return true;
}
