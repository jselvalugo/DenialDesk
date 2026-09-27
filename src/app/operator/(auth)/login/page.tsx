import type { Metadata } from "next";
import { LOCKOUT_MS, SESSION_IDLE_MS } from "@/auth/policy";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signInOperator } from "@/auth/operator-actions";
import { getOperatorSession } from "@/auth/session";
import { getT } from "@/i18n/server";
import { rich } from "@/i18n/rich";
import { SignInForm } from "@/app/login/SignInForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("auth");
  return { title: t("operatorSignIn.pageTitle") };
}

export default async function OperatorSignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const { reason } = await searchParams;
  const session = await getOperatorSession();
  if (session?.mfaVerified) redirect("/operator");

  const t = await getT("auth");
  const notices: Record<string, string> = {
    timeout: t("notice.timeout", { minutes: SESSION_IDLE_MS / 60_000 }),
    locked: t("notice.operatorLocked", { minutes: LOCKOUT_MS / 60_000 }),
  };

  return (
    <>
      <h1 className="font-serif text-[1.375rem] leading-8 font-bold text-primary">
        {t("operatorSignIn.title")}
      </h1>
      <p className="mt-1 mb-6 text-body text-muted">
        {rich(t("operatorSignIn.subtitle"), {
          a: (chunks) => (
            <Link href="/login" className="font-medium text-link hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
      <SignInForm
        submit={signInOperator}
        notice={reason !== undefined && Object.hasOwn(notices, reason) ? notices[reason] : undefined}
      />
    </>
  );
}
