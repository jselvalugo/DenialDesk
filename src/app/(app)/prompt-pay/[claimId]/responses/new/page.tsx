import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { canRecordPromptPay } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { getPromptPayClock } from "@/domain/prompt-pay/queries";
import { getT } from "@/i18n/server";
import { ContestForm } from "./ContestForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("promptPay");
  return { title: t("newContest.title") };
}

export default async function NewContestPage({ params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = await params;
  if (!z.uuid().safeParse(claimId).success) notFound();
  const auth = await requireAuth();
  const today = todayIn();
  const t = await getT("promptPay");
  // Claim number and received date only; no patient data on this page.
  const detail = await withTenant(auth, (tx) => getPromptPayClock(tx, claimId, today));
  if (!detail?.clock?.applies) notFound();
  const { claim } = detail;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <nav aria-label={t("nav.breadcrumb")} className="text-label text-muted">
        <Link href="/prompt-pay" className="font-medium text-link hover:underline">
          {t("detail.breadcrumbPromptPay")}
        </Link>{" "}
        <span aria-hidden>/</span>{" "}
        <Link href={`/prompt-pay/${claim.id}`} className="font-mono font-medium text-link hover:underline">
          {claim.claimNumber}
        </Link>{" "}
        <span aria-hidden>/</span> {t("newContest.breadcrumbRecordContest")}
      </nav>
      <PageHeader title={t("newContest.title")} description={t("newContest.description")} />
      {canRecordPromptPay(auth.role) ? (
        <Panel>
          <ContestForm claimId={claim.id} minDate={claim.receivedDate!} today={today} />
        </Panel>
      ) : (
        <p role="note" className="text-body text-muted">
          {t("action.error.forbiddenRecord")}
        </p>
      )}
    </div>
  );
}
