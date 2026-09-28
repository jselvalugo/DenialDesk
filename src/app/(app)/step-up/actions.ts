"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  claimTotp,
  codeSchema,
  rateLimited,
  releaseAttempt,
  reserveStepUpAttempt,
  type FormState,
} from "@/auth/credentials";
import { LOCKOUT_MS } from "@/auth/policy";
import { clientIp, completeStepUpMfa, requireAuth } from "@/auth/session";
import { stepUpTarget, type StepUpTarget } from "@/auth/step-up-target";
import { systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { getT } from "@/i18n/server";
import { auditSystem } from "@/lib/audit";
import { limitCurrentRequest } from "@/lib/rate-limit";

export type { FormState };

/**
 * What the audit log says a step-up was for: the page's route template and, for one connection's
 * page, its UUID. Never the raw `returnTo`, so nothing free-form can reach the log.
 */
const auditMetadata = (target: StepUpTarget) => ({ route: target.route, route_id: target.routeId });

/**
 * Step-up re-verification (R-7.2.2): the same TOTP check as sign-in, on an already signed-in
 * session. Success records a fresh `mfa_verified_at`, rotates the session token and cookie
 * (`completeStepUpMfa`), and sends the browser back to `returnTo` (only ever one of the
 * integrations pages, length-capped and checked by `stepUpTarget`), where the gated action can be
 * retried.
 *
 * It shares the sign-in attempt counter (`reserveStepUpAttempt`), so codes can't be guessed here
 * without limit, and it refuses, before checking any code, the attempt that would reach the lockout
 * limit (a correct code there must not lock the account). A failure never clears the sign-in lockout counter, and a success doesn't erase
 * earlier failures either (`claimTotp(..., resetLockout: false)`); it only gives back its own
 * attempt (`releaseAttempt`).
 */
export async function verifyStepUp(_: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireAuth();
  const t = await getT("auth");
  const target = stepUpTarget(formData.get("returnTo"));

  const limited = await limitCurrentRequest("mfa");
  if (!limited.allowed) return rateLimited("mfa", limited);
  const parsed = codeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) return { error: t("error.enterCode") };

  const [user] = await systemDb().select().from(users).where(eq(users.id, auth.userId)).limit(1);
  if (!user?.totpSecretEnc || !user.mfaEnrolledAt) redirect("/login");
  if (!(await reserveStepUpAttempt(user.id))) {
    return { error: t("error.tooManyAttempts", { minutes: LOCKOUT_MS / 60_000 }) };
  }

  const result = await claimTotp(
    { id: user.id, totpSecretEnc: user.totpSecretEnc, totpLastStep: user.totpLastStep },
    parsed.data.code,
    false,
    false,
  );
  if (result !== "ok") {
    await auditSystem({
      action: "auth.step_up_failed",
      actorUserId: user.id,
      tenantId: auth.tenantId,
      entityType: "session",
      entityId: auth.sessionId,
      ipAddress: await clientIp(),
      metadata: auditMetadata(target),
    });
    return { error: result === "mismatch" ? t("error.codeMismatch") : t("error.codeReused") };
  }

  await releaseAttempt(user.id);
  // The session was revoked or ended while the code was being checked: nothing was verified, so
  // nothing is audited as verified, and the browser goes to sign in.
  if (!(await completeStepUpMfa(auth.sessionId))) redirect("/login");
  await auditSystem({
    action: "auth.step_up_verified",
    actorUserId: user.id,
    tenantId: auth.tenantId,
    entityType: "session",
    entityId: auth.sessionId,
    ipAddress: await clientIp(),
    metadata: auditMetadata(target),
  });
  redirect(target.path);
}
