import "server-only";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { getT } from "@/i18n/server";
import { auth as enAuth } from "@/i18n/messages/en/auth";
import type { MessageKey } from "@/i18n/messages/types";
import { auditSystem, type AuditAction } from "@/lib/audit";
import { decryptField } from "@/lib/crypto/field";
import type { RateLimitResult } from "@/lib/rate-limit";
import { LOCKOUT_MS, MAX_FAILED_ATTEMPTS } from "./policy";
import { formatMessage } from "@/i18n/translate";
import { clientIp } from "./session";
import { verifyTotp } from "./totp";

// Credential checks shared by practice sign-in (actions.ts) and operator sign-in
// (operator-actions.ts), so both enforce the same lockout, single-use codes, and messages.

export interface FormState {
  error?: string;
}

// One message for wrong password, unknown account, and locked account, so responses never reveal
// which accounts exist (security review finding 3). Locked users are told how to recover.
// English text (used by tests that run in the default locale); actions.ts and operator-actions.ts
// show the translated form via `getT("auth")("error.signInFailed")` (spec: internationalization).
export const SIGN_IN_FAILED = formatMessage(enAuth["error.signInFailed"], { minutes: LOCKOUT_MS / 60_000 });

export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
});

export const codeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});

const RATE_LIMIT_WHAT: Record<"sign_in" | "mfa", MessageKey<"auth">> = {
  sign_in: "rateLimit.signInAttempts",
  mfa: "rateLimit.mfaAttempts",
};

export async function rateLimited(bucket: "sign_in" | "mfa", result: RateLimitResult): Promise<FormState> {
  await auditSystem({ action: "security.rate_limited", ipAddress: await clientIp(), metadata: { bucket } });
  const t = await getT("auth");
  const minutes = Math.max(1, Math.ceil(result.retryAfterSeconds / 60));
  return { error: t("rateLimit.tooMany", { what: t(RATE_LIMIT_WHAT[bucket]), minutes }) };
}

/**
 * Reserves one sign-in attempt atomically before any credential is checked. Every password and
 * MFA attempt counts; only a completed sign-in (password + MFA) resets the counter. Because the
 * reservation and the lock happen in one UPDATE, parallel attempts can't exceed the limit and a
 * correct password can't reset the count between MFA guesses (security review findings 1–2).
 * Returns false when the account is locked.
 */
export async function reserveAttempt(userId: string): Promise<boolean> {
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

export async function recordFailure(userId: string, action: AuditAction): Promise<void> {
  await auditSystem({
    action,
    actorUserId: userId,
    entityType: "user",
    entityId: userId,
    ipAddress: await clientIp(),
  });
}

/** Resets the per-account attempt counter (what a successful two-step check does). */
export async function clearFailures(userId: string): Promise<void> {
  await systemDb().update(users).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, userId));
}

/**
 * Checks a TOTP code and claims its time step atomically, so two simultaneous submissions of the
 * same code can't both succeed (single-use codes). On success the attempt counter resets and, when
 * enrolling, enrollment is recorded.
 */
export async function claimTotp(
  user: { id: string; totpSecretEnc: string; totpLastStep: number | null },
  code: string,
  enrolling: boolean,
): Promise<"ok" | "mismatch" | "reused"> {
  const step = verifyTotp(decryptField(user.totpSecretEnc), code, user.totpLastStep);
  if (step === null) return "mismatch";
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
  return claimed.length === 0 ? "reused" : "ok";
}

// English text; actions.ts and operator-actions.ts show the translated form via `getT("auth")`.
export const CODE_MISMATCH = enAuth["error.codeMismatch"];
export const CODE_REUSED = enAuth["error.codeReused"];
