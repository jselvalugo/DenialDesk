import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { PasswordForm } from "./PasswordForm";

export const metadata: Metadata = { title: "Choose a password" };

export default async function ChoosePasswordPage() {
  const session = await getSession();
  if (!session || session.mfaVerified) redirect("/login");
  if (!session.mustChangePassword) redirect(session.mfaEnrolled ? "/login/mfa" : "/login/mfa/setup");
  return (
    <>
      <h1 className="text-title font-semibold text-text">Choose your password</h1>
      <p className="mt-1 mb-6 text-body text-muted">
        You signed in with a temporary password. Choose your own before setting up two-step verification.
      </p>
      <PasswordForm />
    </>
  );
}
