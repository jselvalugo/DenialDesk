import type { Metadata } from "next";
import Link from "next/link";
import { canManageIntegrations } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { primaryLinkButtonClass } from "@/components/ui/linkButton";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import {
  connectionStatusLabel,
  connectionStatusTone,
  listConnections,
} from "@/domain/integrations/connections";
import { getFormat, getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("integrations.metaTitle") };
}

export default async function IntegrationsPage() {
  const auth = await requireAuth();
  const t = await getT("settings");
  const f = await getFormat();
  const canManage = canManageIntegrations(auth.role);

  const rows = await withTenant(auth, (tx) => listConnections(tx));

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <Panel
        title={t("integrations.listTitle")}
        description={t("integrations.listDescription")}
        actions={
          canManage && (
            <Link href="/settings/integrations/new" className={primaryLinkButtonClass}>
              {t("integrations.newConnection")}
            </Link>
          )
        }
        flush
      >
        {rows.length === 0 ? (
          <EmptyState
            title={t("integrations.emptyTitle")}
            description={
              canManage
                ? t("integrations.emptyDescriptionCanManage")
                : t("integrations.emptyDescriptionReadOnly")
            }
            action={
              canManage && (
                <Link href="/settings/integrations/new" className={primaryLinkButtonClass}>
                  {t("integrations.newConnection")}
                </Link>
              )
            }
          />
        ) : (
          <Table caption={t("integrations.tableCaption")}>
            <thead>
              <tr>
                <Th>{t("integrations.field.name")}</Th>
                <Th>{t("integrations.field.table")}</Th>
                <Th>{t("integrations.field.status")}</Th>
                <Th>{t("integrations.field.lastSync")}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td className="font-medium">
                    <Link href={`/settings/integrations/${row.id}`} className="text-link hover:underline">
                      {row.displayName}
                    </Link>
                  </Td>
                  <Td>{t("integrations.table.patients")}</Td>
                  <Td>
                    <Badge tone={connectionStatusTone(row.status)}>
                      {connectionStatusLabel(row.status, t)}
                    </Badge>
                  </Td>
                  <Td className="tabular text-muted">
                    {row.lastSuccessAt ? f.dateTime(row.lastSuccessAt) : t("integrations.neverSynced")}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
