import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/auth/operator";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { getT } from "@/i18n/server";
import { CreatePracticeForm } from "./CreatePracticeForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("operator");
  return { title: t("newPractice.title") };
}

/** Operator creates a customer practice and its first admin on a page of its own. */
export default async function NewPracticePage() {
  await requireOperator();
  const t = await getT("operator");
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <nav aria-label={t("nav.breadcrumbLabel")} className="text-label text-muted">
        <Link href="/operator" className="font-medium text-link hover:underline">
          {t("list.title")}
        </Link>{" "}
        <span aria-hidden>/</span> {t("newPractice.title")}
      </nav>
      <PageHeader title={t("newPractice.title")} description={t("newPractice.description")} />
      <Panel>
        <div className="max-w-2xl">
          <CreatePracticeForm />
        </div>
      </Panel>
    </div>
  );
}
