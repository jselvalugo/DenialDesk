import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { pendingEnrollmentSecret } from "@/auth/enrollment";
import { getSession } from "@/auth/session";
import { getT } from "@/i18n/server";
import { TotpEnrollment } from "@/components/auth/TotpEnrollment";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("auth");
  return { title: t("mfaSetup.title") };
}

export default async function MfaSetupPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mfaVerified) redirect("/");
  if (session.mustChangePassword) redirect("/login/password");
  if (session.mfaEnrolled) redirect("/login/mfa");

  const pending = await pendingEnrollmentSecret(session);
  if (!pending) redirect("/login");
  return <TotpEnrollment secret={pending.secret} email={pending.email} />;
}
