import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/auth/session";
import { getT } from "@/i18n/server";
import { SignInForm } from "./SignInForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("auth");
  return { title: t("signIn.title") };
}

// Own keys only: `?reason=constructor` must not pick up an Object.prototype function.
const lookup = (table: Record<string, string>, key: string | undefined) =>
  key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const session = await getSession();
  // A leftover demo session (the demo was removed) isn't a sign-in: show the form.
  if (session?.mfaVerified && session.tenantId && session.authMethod !== "demo") redirect("/");

  const t = await getT("auth");
  const notices: Record<string, string> = {
    timeout: t("notice.timeout"),
    locked: t("notice.locked"),
  };
  const errors: Record<string, string> = {
    "no-practice": t("error.noPractice"),
    suspended: t("error.practiceSuspended"),
  };

  return (
    <>
      <h1 className="font-serif text-[1.375rem] leading-8 font-bold text-primary">{t("signIn.title")}</h1>
      <p className="mt-1 mb-6 text-body text-muted">{t("signIn.subtitle")}</p>
      <SignInForm notice={lookup(notices, params.reason) ?? lookup(errors, params.error)} />
    </>
  );
}
