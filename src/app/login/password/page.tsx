import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { getT } from "@/i18n/server";
import { PasswordForm } from "./PasswordForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("auth");
  return { title: t("password.pageTitle") };
}

export default async function ChoosePasswordPage() {
  const session = await getSession();
  if (!session || session.mfaVerified) redirect("/login");
  if (!session.mustChangePassword) redirect(session.mfaEnrolled ? "/login/mfa" : "/login/mfa/setup");
  const t = await getT("auth");
  return (
    <>
      <h1 className="font-serif text-[1.375rem] leading-8 font-bold text-primary">{t("password.title")}</h1>
      <p className="mt-1 mb-6 text-body text-muted">{t("password.subtitle")}</p>
      <PasswordForm />
    </>
  );
}
