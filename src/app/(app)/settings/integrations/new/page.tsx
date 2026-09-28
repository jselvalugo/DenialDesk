import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canManageIntegrations } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Panel } from "@/components/ui/Panel";
import { getT } from "@/i18n/server";
import { syntheticDataOnly } from "@/lib/env";
import { ConnectionForm } from "../ConnectionForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("integrations");
  return { title: t("new.metaTitle") };
}

/** New EHR/PM connection, its own page (DESIGN.md §8). Administrators only. */
export default async function NewConnectionPage() {
  const auth = await requireAuth();
  if (!canManageIntegrations(auth.role)) notFound();
  const t = await getT("integrations");
  const ts = await getT("settings");
  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        label={ts("nav.breadcrumb")}
        items={[
          { label: ts("tabs.integrations"), href: "/settings/integrations" },
          { label: t("new.title") },
        ]}
      />
      <Panel flush>
        {/* Where only synthetic data is allowed, the built-in sandbox is the only possible endpoint. */}
        <ConnectionForm sandbox={syntheticDataOnly()} />
      </Panel>
    </div>
  );
}
