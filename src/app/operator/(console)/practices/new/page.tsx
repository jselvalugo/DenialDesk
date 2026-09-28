import type { Metadata } from "next";
import { requireOperator } from "@/auth/operator";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
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
      <Breadcrumbs
        label={t("nav.breadcrumbLabel")}
        items={[{ label: t("list.title"), href: "/operator" }, { label: t("newPractice.title") }]}
      />
      <PageHeader title={t("newPractice.title")} description={t("newPractice.description")} />
      <Panel flush>
        <CreatePracticeForm />
      </Panel>
    </div>
  );
}
