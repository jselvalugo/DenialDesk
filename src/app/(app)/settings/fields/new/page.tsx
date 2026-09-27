import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canConfigureSettings } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Panel } from "@/components/ui/Panel";
import { getT } from "@/i18n/server";
import { CustomFieldForm } from "../CustomFieldForm";
import { recordsParam } from "../records";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("fields.newMetaTitle") };
}

export default async function NewCustomFieldPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  if (!canConfigureSettings(auth.role)) notFound();
  const t = await getT("settings");
  return (
    <Panel title={t("fields.newTitle")} description={t("fields.newDescription")}>
      <CustomFieldForm entity={recordsParam((await searchParams).records)} />
    </Panel>
  );
}
