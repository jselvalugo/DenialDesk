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
import { ContestForm } from "./ContestForm";

export const metadata: Metadata = { title: "Record payer contest" };

export default async function NewContestPage({ params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = await params;
  if (!z.uuid().safeParse(claimId).success) notFound();
  const auth = await requireAuth();
  const today = todayIn();
  // Claim number and received date only; no patient data on this page.
  const detail = await withTenant(auth, (tx) => getPromptPayClock(tx, claimId, today));
  if (!detail?.clock?.applies) notFound();
  const { claim } = detail;

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-label text-muted">
        <Link href="/prompt-pay" className="font-medium text-link hover:underline">
          Prompt pay
        </Link>{" "}
        <span aria-hidden>/</span>{" "}
        <Link href={`/prompt-pay/${claim.id}`} className="font-mono font-medium text-link hover:underline">
          {claim.claimNumber}
        </Link>{" "}
        <span aria-hidden>/</span> Record contest
      </nav>
      <PageHeader
        title="Record payer contest"
        description="The payer contested this claim or asked for more information. This meets the pay-or-contest milestone only; the pay-or-deny clock keeps running."
      />
      {canRecordPromptPay(auth.role) ? (
        <Panel>
          <ContestForm claimId={claim.id} minDate={claim.receivedDate!} today={today} />
        </Panel>
      ) : (
        <p role="note" className="text-body text-muted">
          Your role can view prompt-pay clocks but not record responses.
        </p>
      )}
    </div>
  );
}
