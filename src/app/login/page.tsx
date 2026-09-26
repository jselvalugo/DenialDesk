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
  account: "Sign in with your DenialDesk account to open that page.",
};
const errors: Record<string, string> = {
  "no-practice": "Your account isn't linked to a practice yet. Contact your administrator.",
  suspended: "This practice's access is suspended. Contact DenialDesk support.",
};

// Own keys only: `?reason=constructor` must not pick up an Object.prototype function.
const lookup = (table: Record<string, string>, key: string | undefined) =>
  key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const session = await getSession();
  // A demo session still sees the form, so the owner can sign in from a browser that explored the demo.
  const demo = session?.authMethod === "demo";
  if (session?.mfaVerified && session.tenantId && !demo) redirect("/");

  return (
    <>
      <h1 className="font-serif text-[1.375rem] leading-8 font-bold text-primary">Sign in</h1>
      <p className="mt-1 mb-6 text-body text-muted">
        Use your practice account. You&apos;ll confirm with your authenticator app next.
      </p>
      <SignInForm
        notice={
          [
            lookup(notices, params.reason) ?? lookup(errors, params.error),
            demo ? "You're exploring the demo practice. Signing in ends the demo session." : undefined,
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
      />
      {demoLoginEnabled() && !demo && <DemoSignIn />}
    </>
  );
}
