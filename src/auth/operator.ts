import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { isDemoGuestEmail } from "./demo";
import { getSession, requireAuth, type AuthContext } from "./session";

/**
 * The platform operator: exactly one account, named by PLATFORM_OPERATOR_EMAIL, signed in with
 * password + MFA. Demo sessions never qualify, even if misconfigured.
 */
export function isPlatformOperator(
  auth: Pick<AuthContext, "email" | "authMethod">,
  operatorEmail: string | undefined = process.env.PLATFORM_OPERATOR_EMAIL,
): boolean {
  if (!operatorEmail) return false;
  if (auth.authMethod !== "password_mfa" || isDemoGuestEmail(auth.email)) return false;
  return auth.email.trim().toLowerCase() === operatorEmail.trim().toLowerCase();
}

/** For the operator console: everyone else, signed in or not, gets a 404. */
export const requireOperator = cache(async (): Promise<AuthContext> => {
  if (!(await getSession())) notFound();
  const auth = await requireAuth();
  if (!isPlatformOperator(auth)) notFound();
  return auth;
});
