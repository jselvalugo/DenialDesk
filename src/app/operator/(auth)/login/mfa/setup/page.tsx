import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { pendingEnrollmentSecret } from "@/auth/enrollment";
import { confirmOperatorMfaEnrollment } from "@/auth/operator-actions";
import { getOperatorSession } from "@/auth/session";
import { getT } from "@/i18n/server";
import { TotpEnrollment } from "@/components/auth/TotpEnrollment";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("auth");
  return { title: t("operatorMfaSetup.pageTitle") };
}

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
