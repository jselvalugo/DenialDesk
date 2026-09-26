"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { auditSystem } from "@/lib/audit";
import { isProduction } from "@/lib/env";
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
import {
  hasPracticeMembership,
  isOperatorEmail,
  OperatorSetupError,
  operatorEmail,
  setUpOperatorAccount,
} from "./operator-account";
import { decoyHash, passwordProblem, verifyPassword } from "./password";
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

/** Ends this browser's previous operator session, if any, before a new one replaces it. */
async function replacePreviousOperatorSession(): Promise<void> {
  const previous = await getOperatorSession();
  if (previous) await revokeSession(previous.sessionId);
}

export async function signInOperator(_: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };
  const limited = await limitCurrentRequest("sign_in");
  if (!limited.allowed) return rateLimited("sign_in", "sign-in attempts", limited);

  const [user] = isOperatorEmail(parsed.data.email)
    ? await systemDb()
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = lower(${parsed.data.email})`)
        .limit(1)
    : [];
  // Every account but the operator (and a disabled or practice-linked one) looks unknown here.
  if (!user || user.disabledAt || (await hasPracticeMembership(user.id))) {
    await verifyPassword(parsed.data.password, await decoyHash()); // equal timing
    await auditSystem({ action: "operator.login_failed", ipAddress: await clientIp() });
    return { error: SIGN_IN_FAILED };
  }
  if (!(await reserveAttempt(user.id))) {
    await verifyPassword(parsed.data.password, await decoyHash()); // equal timing while locked
    await auditSystem({ action: "operator.login_failed", actorUserId: user.id, metadata: { locked: true } });
    return { error: SIGN_IN_FAILED };
  }
  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    await recordFailure(user.id, "operator.login_failed");
    return { error: SIGN_IN_FAILED };
  }

  // The attempt counter resets only after MFA succeeds.
  await replacePreviousOperatorSession();
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
  const ip = await clientIp();
  if (enrolling) await auditSystem({ action: "operator.mfa_enrolled", actorUserId: user.id, ipAddress: ip });
  await auditSystem({ action: "operator.login_succeeded", actorUserId: user.id, ipAddress: ip });
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
    await auditSystem({ action: "operator.logout", actorUserId: session.userId });
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

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time comparison with SEED_TOKEN (at least 32 characters, or setup is off). */
function setupCodeMatches(supplied: string): boolean {
  const expected = process.env.SEED_TOKEN;
  if (!expected || expected.length < 32) return false;
  return timingSafeEqual(digest(supplied), digest(expected));
}

const setupSchema = z.object({
  email: z.email().max(254),
  code: z.string().trim().min(1).max(256),
  password: z.string().max(128),
  confirm: z.string().max(128),
});

const SETUP_FAILED = "The email or setup code is incorrect.";

/**
 * First-time setup and recovery of the operator account, pre-production only. Needs the configured
 * operator email and the environment's setup code; then continues to two-step enrollment.
 */
export async function setUpOperator(_: FormState, formData: FormData): Promise<FormState> {
  if (isProduction()) return { error: "Operator setup isn't available here." };
  const limited = await limitCurrentRequest("seed");
  if (!limited.allowed) return rateLimited("seed", "setup attempts", limited);
  const parsed = setupSchema.safeParse({
    email: formData.get("email"),
    code: formData.get("code"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) return { error: "Enter your email, the setup code, and a new password twice." };
  if (!operatorEmail()) return { error: "The platform console isn't configured in this environment." };

  // Check the code even when the email is wrong, so both failures take the same path.
  const codeOk = setupCodeMatches(parsed.data.code);
  if (!codeOk || !isOperatorEmail(parsed.data.email)) {
    await auditSystem({ action: "operator.setup_failed", ipAddress: await clientIp() });
    return { error: SETUP_FAILED };
  }
  const problem = passwordProblem(parsed.data.password);
  if (problem) return { error: problem };
  if (parsed.data.password !== parsed.data.confirm) return { error: "The passwords don't match." };

  let userId: string;
  try {
    ({ userId } = await setUpOperatorAccount({ email: parsed.data.email, password: parsed.data.password }));
  } catch (error) {
    if (error instanceof OperatorSetupError) {
      await auditSystem({ action: "operator.setup_failed", ipAddress: await clientIp() });
      return { error: error.message };
    }
    throw error;
  }
  await replacePreviousOperatorSession();
  await createSession(userId, { authMethod: "operator" });
  redirect("/operator/login/mfa/setup");
}
