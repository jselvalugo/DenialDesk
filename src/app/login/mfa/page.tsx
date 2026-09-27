import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { getT } from "@/i18n/server";
import { rich } from "@/i18n/rich";
import { CodeForm } from "./CodeForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("auth");
  return { title: t("mfaVerify.pageTitle") };
}

export default async function MfaPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mfaVerified) redirect("/");
  if (session.mustChangePassword) redirect("/login/password");
  if (!session.mfaEnrolled) redirect("/login/mfa/setup");

  const t = await getT("auth");
  return (
    <>
      <h1 className="font-serif text-[1.375rem] leading-8 font-bold text-primary">{t("mfaVerify.title")}</h1>
      <p className="mt-1 mb-6 text-body text-muted">{t("mfaVerify.subtitle")}</p>
      <CodeForm mode="verify" />
      <p className="mt-6 text-label text-muted">
        {rich(t("mfaVerify.lostAccess"), {
          a: (chunks) => (
            <Link href="/login" className="font-medium text-link hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </>
  );
}
