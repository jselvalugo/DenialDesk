import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { canManageIntegrations } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { withTenant } from "@/db/tenant";
import { getConnection } from "@/domain/integrations/connections";
import { listSyncRuns } from "@/domain/integrations/sync-runs";
import { getFormat, getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("integrations.runs.metaTitle") };
}

/** Counts and codes only (spec "Sync history"): no patient data, ever. Empty until PI2b's sync engine exists. */
export default async function SyncHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();
  if (!canManageIntegrations(auth.role)) notFound();
  const t = await getT("settings");
  const tc = await getT("common");
  const f = await getFormat();

  const { connection, runs } = await withTenant(auth, async (tx) => {
    const connection = await getConnection(tx, id);
    if (!connection) return { connection: null, runs: [] };
    return { connection, runs: await listSyncRuns(tx, id) };
  });
  if (!connection) notFound();

  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-6">
      <Breadcrumbs
        label={t("nav.breadcrumb")}
        items={[
          { label: t("integrations.breadcrumbList"), href: "/settings/integrations" },
          { label: connection.displayName, href: `/settings/integrations/${connection.id}` },
          { label: t("integrations.runs.title") },
        ]}
      />
      <PageHeader title={t("integrations.runs.title")} description={t("integrations.runs.description")} />
      <Panel flush>
        {runs.length === 0 ? (
          <EmptyState
            title={t("integrations.runs.emptyTitle")}
            description={t("integrations.runs.emptyDescription")}
          />
        ) : (
          <Table caption={t("integrations.runs.title")}>
            <thead>
              <tr>
                <Th>{t("integrations.field.status")}</Th>
                <Th>{tc("word.date")}</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <Tr key={run.id}>
                  <Td>{run.status}</Td>
                  <Td className="tabular">{f.dateTime(run.queuedAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
