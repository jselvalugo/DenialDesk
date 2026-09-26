import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { demoLoginEnabled } from "@/lib/env";
import { DemoSignIn } from "./DemoSignIn";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: "Sign in" };

const notices: Record<string, string> = {
  timeout: "You were signed out after 15 minutes without activity.",
  locked: "Too many attempts. Try again in 15 minutes or contact your administrator.",
};
const errors: Record<string, string> = {
  "no-practice": "Your account isn't linked to a practice yet. Contact your administrator.",
  suspended: "This practice's access is suspended. Contact DenialDesk support.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const session = await getSession();
  if (session?.mfaVerified && session.tenantId) redirect("/");

  return (
    <>
      <h1 className="text-title font-semibold text-text">Sign in</h1>
      <p className="mt-1 mb-6 text-body text-muted">
        Use your practice account. You&apos;ll confirm with your authenticator app next.
      </p>
      <SignInForm notice={notices[params.reason ?? ""] ?? errors[params.error ?? ""]} />
      {demoLoginEnabled() && <DemoSignIn />}
    </>
  );
}
