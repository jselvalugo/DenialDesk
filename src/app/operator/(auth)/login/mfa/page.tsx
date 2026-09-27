import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { verifyOperatorMfa } from "@/auth/operator-actions";
import { getOperatorSession } from "@/auth/session";
import { getT } from "@/i18n/server";
import { CodeForm } from "@/app/login/mfa/CodeForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("auth");
  return { title: t("operatorMfaVerify.pageTitle") };
}

export default async function OperatorMfaPage() {
  const session = await getOperatorSession();
  if (!session) redirect("/operator/login");
  if (session.mfaVerified) redirect("/operator");
  if (!session.mfaEnrolled) redirect("/operator/login/mfa/setup");

  const t = await getT("auth");
  return (
    <>
      <h1 className="font-serif text-[1.375rem] leading-8 font-bold text-primary">{t("mfaVerify.title")}</h1>
      <p className="mt-1 mb-6 text-body text-muted">{t("mfaVerify.subtitle")}</p>
      <CodeForm mode="verify" submit={verifyOperatorMfa} />
    </>
  );
}
