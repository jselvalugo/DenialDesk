import "server-only";
import { notFound, redirect } from "next/navigation";
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

/**
 * For the operator console. Signed-out visitors and demo sessions go to sign-in (the owner needs a
 * way in, and a shared demo session must not trap them behind a 404); every signed-in practice
 * account that isn't the operator gets a 404 so the console stays invisible to practice users.
 */
export const requireOperator = cache(async (): Promise<AuthContext> => {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.authMethod === "demo") redirect("/login?reason=account");
  const auth = await requireAuth();
  if (!isPlatformOperator(auth)) notFound();
  return auth;
});
