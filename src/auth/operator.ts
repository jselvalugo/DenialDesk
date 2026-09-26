import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auditSystem } from "@/lib/audit";
import { hasPracticeMembership, isOperatorEmail } from "./operator-account";
import { clientIp, getOperatorSession, revokeSession } from "./session";

/** Who is using the platform console. The operator belongs to no practice. */
export interface OperatorContext {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
}

/**
 * For the platform console. Reads only the operator session (its own cookie), so practice and demo
 * sessions in the same browser neither grant access nor get in the way. Anyone without a verified
 * operator session is sent to /operator/login. A session whose account stopped qualifying (email no
 * longer configured, or it gained a practice membership) is ended.
 */
export const requireOperator = cache(async (): Promise<OperatorContext> => {
  const session = await getOperatorSession();
  if (!session) redirect("/operator/login");
  if (!session.mfaVerified) {
    redirect(session.mfaEnrolled ? "/operator/login/mfa" : "/operator/login/mfa/setup");
  }
  const reason = !isOperatorEmail(session.email)
    ? "email_mismatch"
    : (await hasPracticeMembership(session.userId))
      ? "practice_membership"
      : null;
  if (reason) {
    await revokeSession(session.sessionId);
    await auditSystem({
      action: "operator.session_revoked",
      actorUserId: session.userId,
      entityType: "session",
      entityId: session.sessionId,
      ipAddress: await clientIp(),
      metadata: { reason },
    });
    redirect("/operator/login");
  }
  return {
    sessionId: session.sessionId,
    userId: session.userId,
    email: session.email,
    displayName: session.displayName,
  };
});
