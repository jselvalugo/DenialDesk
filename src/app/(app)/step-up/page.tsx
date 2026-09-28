import type { Metadata } from "next";
import Link from "next/link";
import { requireAuth } from "@/auth/session";
import { CodeForm } from "@/app/login/mfa/CodeForm";
import { Panel } from "@/components/ui/Panel";
import { getT } from "@/i18n/server";
import { verifyStepUp } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("auth");
  return { title: t("stepUp.pageTitle") };
}

/**
 * Step-up MFA re-verification (R-7.2.2): a gated action (Submit's attestation, Resume, Revoke)
 * sends the admin here with `returnTo` set to the page they came from; on success they land back
 * there and can retry the action, which now sees a fresh `mfaVerifiedAt`.
 */
export default async function StepUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAuth();
  const t = await getT("auth");
  const raw = (await searchParams).returnTo;
  const returnTo = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

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
