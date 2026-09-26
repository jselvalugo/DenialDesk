import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { operatorSetupAllowed } from "@/auth/operator-account";
import { signInOperator } from "@/auth/operator-actions";
import { getOperatorSession } from "@/auth/session";
import { SignInForm } from "@/app/login/SignInForm";

export const metadata: Metadata = { title: "Platform console sign-in" };

const notices: Record<string, string> = {
  timeout: "You were signed out after 15 minutes without activity.",
  locked: "Too many attempts. Try again in 15 minutes.",
};

export default async function OperatorSignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const { reason } = await searchParams;
  const session = await getOperatorSession();
  if (session?.mfaVerified) redirect("/operator");

  return (
    <>
      <h1 className="font-serif text-[1.375rem] leading-8 font-bold text-primary">Operator sign-in</h1>
      <p className="mt-1 mb-6 text-body text-muted">
        For the platform operator only. Practice users sign in at{" "}
        <Link href="/login" className="font-medium text-link hover:underline">
          the practice sign-in page
        </Link>
        .
      </p>
      <SignInForm
        submit={signInOperator}
        notice={reason !== undefined && Object.hasOwn(notices, reason) ? notices[reason] : undefined}
      />
      {operatorSetupAllowed() && (
        <p className="mt-6 text-label text-muted">
          First time here, or locked out?{" "}
          <Link href="/operator/setup" className="font-medium text-link hover:underline">
            Set up the operator account
          </Link>
        </p>
      )}
    </>
  );
}
