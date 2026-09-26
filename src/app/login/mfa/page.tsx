import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { CodeForm } from "./CodeForm";

export const metadata: Metadata = { title: "Verify sign-in" };

export default async function MfaPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mfaVerified) redirect("/");
  if (session.mustChangePassword) redirect("/login/password");
  if (!session.mfaEnrolled) redirect("/login/mfa/setup");

  return (
    <>
      <h1 className="font-serif text-[1.375rem] leading-8 font-bold text-primary">Two-step verification</h1>
      <p className="mt-1 mb-6 text-body text-muted">Enter the code shown in your authenticator app.</p>
      <CodeForm mode="verify" />
      <p className="mt-6 text-label text-muted">
        Lost access to your authenticator? Ask your practice administrator to reset it.{" "}
        <Link href="/login" className="font-medium text-link hover:underline">
          Use a different account
        </Link>
      </p>
    </>
  );
}
