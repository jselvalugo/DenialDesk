"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  claimTotp,
  codeSchema,
  rateLimited,
  releaseAttempt,
  reserveAttempt,
  type FormState,
} from "@/auth/credentials";
import { LOCKOUT_MS } from "@/auth/policy";
import { clientIp, completeStepUpMfa, requireAuth } from "@/auth/session";
import { systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { getT } from "@/i18n/server";
import { auditSystem } from "@/lib/audit";
import { limitCurrentRequest } from "@/lib/rate-limit";
import { safeInternalPath } from "@/lib/safe-path";

export type { FormState };

const DEFAULT_RETURN = "/settings/integrations";

/** Where the step-up was for, without a query string (audit records paths, never query strings). */
const auditPath = (returnTo: string) => returnTo.split("?")[0]!;

/**
 * Step-up re-verification (R-7.2.2): the same TOTP check as sign-in, on an already signed-in
 * session. Success records a fresh `mfa_verified_at`, rotates the session token and cookie
 * (`completeStepUpMfa`), and sends the browser back to `returnTo` (only ever a same-origin,
 * allow-listed path: `safeInternalPath`), where the gated action can be retried.
 *
 * It shares the sign-in attempt limiter (`reserveAttempt`), so codes can't be guessed here
 * without limit. A failure never clears the sign-in lockout counter, and a success doesn't erase
 * earlier failures either (`claimTotp(..., resetLockout: false)`); it only gives back its own
 * attempt (`releaseAttempt`).
 */
export async function verifyStepUp(_: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireAuth();
  const t = await getT("auth");
  const returnTo = safeInternalPath(formData.get("returnTo"), DEFAULT_RETURN);

  const limited = await limitCurrentRequest("mfa");
  if (!limited.allowed) return rateLimited("mfa", limited);
  const parsed = codeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) return { error: t("error.enterCode") };

  const [user] = await systemDb().select().from(users).where(eq(users.id, auth.userId)).limit(1);
  if (!user?.totpSecretEnc || !user.mfaEnrolledAt) redirect("/login");
  if (!(await reserveAttempt(user.id))) {
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
      metadata: { path: auditPath(returnTo) },
    });
    return { error: result === "mismatch" ? t("error.codeMismatch") : t("error.codeReused") };
  }

  await releaseAttempt(user.id);
  await completeStepUpMfa(auth.sessionId);
  await auditSystem({
    action: "auth.step_up_verified",
    actorUserId: user.id,
    tenantId: auth.tenantId,
    entityType: "session",
    entityId: auth.sessionId,
    ipAddress: await clientIp(),
    metadata: { path: auditPath(returnTo) },
  });
  redirect(returnTo);
}
