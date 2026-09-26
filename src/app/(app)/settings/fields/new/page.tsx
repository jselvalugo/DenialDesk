import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canConfigureSettings } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Panel } from "@/components/ui/Panel";
import { CustomFieldForm } from "../CustomFieldForm";
import { recordsParam } from "../records";

export const metadata: Metadata = { title: "Add custom field" };

export default async function NewCustomFieldPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  if (!canConfigureSettings(auth.role)) notFound();
  return (
    <Panel title="Add a custom field" description="The field appears on every record of the chosen type.">
      <CustomFieldForm entity={recordsParam((await searchParams).records)} />
    </Panel>
  );
}
