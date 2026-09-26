import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifyOperatorMfa } from "@/auth/operator-actions";
import { getOperatorSession } from "@/auth/session";
import { CodeForm } from "@/app/login/mfa/CodeForm";

export const metadata: Metadata = { title: "Verify operator sign-in" };

export default async function OperatorMfaPage() {
  const session = await getOperatorSession();
  if (!session) redirect("/operator/login");
  if (session.mfaVerified) redirect("/operator");
  if (!session.mfaEnrolled) redirect("/operator/login/mfa/setup");

  return (
    <>
      <h1 className="font-serif text-[1.375rem] leading-8 font-bold text-primary">Two-step verification</h1>
      <p className="mt-1 mb-6 text-body text-muted">Enter the code shown in your authenticator app.</p>
      <CodeForm mode="verify" submit={verifyOperatorMfa} />
      <p className="mt-6 text-label text-muted">
        Lost access to your authenticator?{" "}
        <Link href="/operator/setup" className="font-medium text-link hover:underline">
          Recover the operator account
        </Link>
      </p>
    </>
  );
}
