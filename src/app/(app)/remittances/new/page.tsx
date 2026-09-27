import type { Metadata } from "next";
import Link from "next/link";
import { canPostRemittances } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { getT } from "@/i18n/server";
import { syntheticDataOnly } from "@/lib/env";
import { UploadRemittanceForm } from "./UploadRemittanceForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("remittances");
  return { title: t("new.title") };
}

export default async function NewRemittancePage() {
  const auth = await requireAuth();
  const t = await getT("remittances");
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <nav aria-label={t("nav.breadcrumb")} className="text-label text-muted">
        <Link href="/remittances" className="font-medium text-link hover:underline">
          {t("new.breadcrumbRemittances")}
        </Link>{" "}
        <span aria-hidden>/</span> {t("new.breadcrumbNew")}
      </nav>
      <PageHeader title={t("new.title")} description={t("new.description")} />
      {canPostRemittances(auth.role) ? (
        <Panel>
          <UploadRemittanceForm syntheticOnly={syntheticDataOnly()} />
        </Panel>
      ) : (
        <p role="note" className="text-body text-muted">
          {t("action.error.forbiddenUpload")}{" "}
          <Link href="/remittances" className="font-medium text-link hover:underline">
            {t("new.backToRemittances")}
          </Link>
        </p>
      )}
    </div>
  );
}
