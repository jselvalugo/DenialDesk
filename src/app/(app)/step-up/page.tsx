import type { Metadata } from "next";
import Link from "next/link";
import { CodeForm } from "@/app/login/mfa/CodeForm";
import { requireAuth } from "@/auth/session";
import { stepUpTarget } from "@/auth/step-up-target";
import { Panel } from "@/components/ui/Panel";
import { getT } from "@/i18n/server";
import { verifyStepUp } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("auth");
  return { title: t("stepUp.pageTitle") };
}

/**
 * Step-up MFA re-verification (R-7.2.2): a gated action (Submit, Resume) sends the administrator
 * here with `returnTo` set to the page they came from; on success they land back there and can
 * retry, and the action now sees a fresh `mfa_verified_at`. `returnTo` is untrusted input:
 * `stepUpTarget` keeps it to one of the integrations pages.
 */
export default async function StepUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAuth();
  const t = await getT("auth");
  const returnTo = stepUpTarget((await searchParams).returnTo).path;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 py-10">
      <Panel title={t("stepUp.title")} description={t("stepUp.subtitle")}>
        <CodeForm mode="verify" submit={verifyStepUp} hidden={{ returnTo }} />
        <p className="mt-4 text-label text-muted">
          <Link href={returnTo} className="font-medium text-link hover:underline">
            {t("stepUp.cancel")}
          </Link>
        </p>
      </Panel>
    </div>
  );
}
