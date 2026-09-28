import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canManageIntegrations } from "@/auth/permissions";
import { hasRecentMfa, requireAuth } from "@/auth/session";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { getT } from "@/i18n/server";
import { syntheticDataOnly } from "@/lib/env";
import { ConnectionForm } from "../ConnectionForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("integrations.new.metaTitle") };
}

/** Own page (DESIGN.md §8): connecting an integration never happens inline on the list. */
export default async function NewConnectionPage() {
  const auth = await requireAuth();
  if (!canManageIntegrations(auth.role)) notFound();
  const t = await getT("settings");
  const syntheticOnly = syntheticDataOnly();
  // Only a real (non-sandbox) connection needs the residency attestation and its step-up (a
  // synthetic-only environment can only ever create a sandbox connection, `assertEnvironmentAllows`
  // refuses a real one there). Checked here, before the form renders, rather than only after
  // Submit fails: a client-side redirect to `/step-up` loses whatever the admin had already typed,
  // so a stale verification is caught up front instead (security/correctness review PR #81, item
  // 19).
  const requiresFreshMfa = !syntheticOnly && !hasRecentMfa(auth.mfaVerifiedAt);

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-6">
      <Breadcrumbs
        label={t("nav.breadcrumb")}
        items={[
          { label: t("integrations.listTitle"), href: "/settings/integrations" },
          { label: t("integrations.new.title") },
        ]}
      />
      <PageHeader title={t("integrations.new.title")} description={t("integrations.new.description")} />
      <Panel flush>
        <ConnectionForm syntheticOnly={syntheticOnly} requiresFreshMfa={requiresFreshMfa} />
      </Panel>
    </div>
  );
}
