"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { claimTotp, codeSchema, rateLimited, reserveAttempt, type FormState } from "@/auth/credentials";
import { LOCKOUT_MS } from "@/auth/policy";
import { requireAuth } from "@/auth/session";
import { clientIp, completeStepUpMfa } from "@/auth/session";
import { systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { getT } from "@/i18n/server";
import { auditSystem } from "@/lib/audit";
import { limitCurrentRequest } from "@/lib/rate-limit";
import { safeInternalPath } from "@/lib/safe-path";

export type { FormState };

/**
 * Step-up re-verification (R-7.2.2): the same TOTP check as sign-in, on an already fully signed-in
 * session. No redirect to "/" — success rotates the session token/cookie (`completeStepUpMfa`,
 * same as a fresh sign-in) and records a fresh `mfaVerifiedAt`, then sends the browser back to
 * `returnTo`, where the gated action can be retried.
 */
export async function verifyStepUp(_: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireAuth();
  const t = await getT("auth");
  const returnTo = safeInternalPath(formData.get("returnTo"), "/settings/integrations");

  const limited = await limitCurrentRequest("mfa");
  if (!limited.allowed) return rateLimited("mfa", limited);
  const parsed = codeSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) return { error: t("error.enterCode") };

  const [user] = await systemDb().select().from(users).where(eq(users.id, auth.userId)).limit(1);
  if (!user?.totpSecretEnc || !user.mfaEnrolledAt) redirect("/login");
  // Shared attempt-limiting counter with sign-in (security review PR #81), but a step-up's own
  // success never resets it — see `claimTotp`'s `resetLockout` parameter below.
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
      ipAddress: await clientIp(),
      metadata: { path: returnTo },
    });
    return { error: result === "mismatch" ? t("error.codeMismatch") : t("error.codeReused") };
  }

  await completeStepUpMfa(auth.sessionId);
  await auditSystem({
    action: "auth.step_up_verified",
    actorUserId: user.id,
    tenantId: auth.tenantId,
    ipAddress: await clientIp(),
    metadata: { path: returnTo },
  });
  redirect(returnTo);
}
