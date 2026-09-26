import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { pendingEnrollmentSecret } from "@/auth/enrollment";
import { confirmOperatorMfaEnrollment } from "@/auth/operator-actions";
import { getOperatorSession } from "@/auth/session";
import { TotpEnrollment } from "@/components/auth/TotpEnrollment";

export const metadata: Metadata = { title: "Set up operator two-step verification" };

export default async function OperatorMfaSetupPage() {
  const session = await getOperatorSession();
  if (!session) redirect("/operator/login");
  if (session.mfaVerified) redirect("/operator");
  if (session.mfaEnrolled) redirect("/operator/login/mfa");

  const pending = await pendingEnrollmentSecret(session);
  if (!pending) redirect("/operator/login");
  return (
    <TotpEnrollment secret={pending.secret} email={pending.email} submit={confirmOperatorMfaEnrollment} />
  );
}
