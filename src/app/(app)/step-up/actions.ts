"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  claimTotp,
  codeSchema,
  rateLimited,
  recordFailure,
  reserveAttempt,
  type FormState,
} from "@/auth/credentials";
import { LOCKOUT_MS } from "@/auth/policy";
import { requireAuth } from "@/auth/session";
import { clientIp, completeStepUpMfa } from "@/auth/session";
import { systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { getT } from "@/i18n/server";
import { auditSystem } from "@/lib/audit";
import { limitCurrentRequest } from "@/lib/rate-limit";

export type { FormState };

/**
 * Only an internal, single-segment-per-slash relative path is trusted (never `//host/...` or an
 * absolute URL, which could send someone off-site after they just proved who they are).
 */
function safeReturnTo(raw: FormDataEntryValue | null): string {
  const value = typeof raw === "string" ? raw : "";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("://")) {
    return "/settings/integrations";
  }
  return value;
}

/**
 * Step-up re-verification (R-7.2.2): the same TOTP check as sign-in, on an already fully signed-in
 * session. No token rotation and no redirect to "/" — success records a fresh `mfaVerifiedAt` and
 * sends the browser back to `returnTo`, where the gated action can be retried.
 */
export async function verifyStepUp(_: FormState, formData: FormData): Promise<FormState> {
  const auth = await requireAuth();
  const t = await getT("auth");
  const returnTo = safeReturnTo(formData.get("returnTo"));

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
  );
  if (result !== "ok") {
    await recordFailure(user.id, "auth.step_up_failed");
    return { error: result === "mismatch" ? t("error.codeMismatch") : t("error.codeReused") };
  }

  await completeStepUpMfa(auth.sessionId);
  await auditSystem({
    action: "auth.step_up_verified",
    actorUserId: user.id,
    tenantId: auth.tenantId,
    ipAddress: await clientIp(),
  });
  redirect(returnTo);
}
