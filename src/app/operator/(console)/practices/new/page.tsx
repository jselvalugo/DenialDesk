import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/auth/operator";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { CreatePracticeForm } from "./CreatePracticeForm";

export const metadata: Metadata = { title: "New practice" };

/** Operator creates a customer practice and its first admin on a page of its own. */
export default async function NewPracticePage() {
  await requireOperator();
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-label text-muted">
        <Link href="/operator" className="font-medium text-link hover:underline">
          Practices
        </Link>{" "}
        <span aria-hidden>/</span> New practice
      </nav>
      <PageHeader
        title="New practice"
        description="Creates the practice and its first administrator, who can then add their team. Record the signed BAA on the practice's page next."
      />
      <Panel>
        <div className="max-w-2xl">
          <CreatePracticeForm />
        </div>
      </Panel>
    </div>
  );
}
