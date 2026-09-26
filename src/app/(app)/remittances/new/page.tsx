import type { Metadata } from "next";
import Link from "next/link";
import { canPostRemittances } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { syntheticDataOnly } from "@/lib/env";
import { UploadRemittanceForm } from "./UploadRemittanceForm";

export const metadata: Metadata = { title: "New remittance" };

export default async function NewRemittancePage() {
  const auth = await requireAuth();
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-label text-muted">
        <Link href="/remittances" className="font-medium text-link hover:underline">
          Remittances
        </Link>{" "}
        <span aria-hidden>/</span> New
      </nav>
      <PageHeader
        title="New remittance"
        description="Upload an 835 from the payer or clearinghouse. DenialDesk checks that it balances and matches your claims before anything is posted."
      />
      {canPostRemittances(auth.role) ? (
        <Panel>
          <UploadRemittanceForm syntheticOnly={syntheticDataOnly()} />
        </Panel>
      ) : (
        <p role="note" className="text-body text-muted">
          Your role can view remittances but not load them.{" "}
          <Link href="/remittances" className="font-medium text-link hover:underline">
            Back to remittances
          </Link>
        </p>
      )}
    </div>
  );
}
