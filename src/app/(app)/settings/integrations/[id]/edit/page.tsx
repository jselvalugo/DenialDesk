import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { canManageIntegrations } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { getConnection } from "@/domain/integrations/connections";
import { getT } from "@/i18n/server";
import { syntheticDataOnly } from "@/lib/env";
import { ConnectionForm } from "../../ConnectionForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("integrations.action.edit") };
}

/** Own page (DESIGN.md §8); draft only — the DB trigger locks the endpoint fields otherwise. */
export default async function EditConnectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();
  if (!canManageIntegrations(auth.role)) notFound();
  const t = await getT("settings");

  const connection = await withTenant(auth, (tx) => getConnection(tx, id));
  if (!connection) notFound();
  if (connection.status !== "draft") notFound();

  return (
    <div className="mx-auto flex max-w-[900px] flex-col gap-6">
      <Breadcrumbs
        label={t("nav.breadcrumb")}
        items={[
          { label: t("integrations.breadcrumbList"), href: "/settings/integrations" },
          { label: connection.displayName, href: `/settings/integrations/${connection.id}` },
          { label: t("integrations.action.edit") },
        ]}
      />
      <PageHeader title={t("integrations.action.edit")} />
      <Panel flush>
        <ConnectionForm
          connection={{
            id: connection.id,
            displayName: connection.displayName,
            baseUrl: connection.baseUrl,
            clientId: connection.clientId,
            mrnIdentifierSystem: connection.mrnIdentifierSystem,
            isSandbox: connection.isSandbox,
            usResidencyAttested: connection.usResidencyAttestedAt !== null,
          }}
          syntheticOnly={syntheticDataOnly()}
        />
      </Panel>
    </div>
  );
}
