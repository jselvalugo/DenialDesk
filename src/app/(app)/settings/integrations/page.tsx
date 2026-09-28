import type { Metadata } from "next";
import Link from "next/link";
import { canManageIntegrations } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import {
  CONNECTION_STATUS_LABEL_KEYS,
  CONNECTION_STATUS_TONE,
  listConnections,
} from "@/domain/integrations/connections";
import { getFormat, getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("integrations");
  return { title: t("meta.title") };
}

/**
 * Settings › Integrations (docs/specs/patient-integrations.md PI1b-2). Every role sees which EHR/PM
 * connection exists, its status, and when it last synced — the same summary the tab-bar drop-down
 * gives everyone (specs/erp-shell.md). Configuration only, no PHI, so no audit event. Only
 * administrators open a connection or create one.
 */
export default async function IntegrationsPage() {
  const auth = await requireAuth();
  const t = await getT("integrations");
  const tc = await getT("common");
  const format = await getFormat();
  const canManage = canManageIntegrations(auth.role);
  const connections = await withTenant(auth, (tx) => listConnections(tx));

  return (
    <Panel
      title={t("list.panelTitle")}
      description={t("list.panelDescription")}
      actions={
        canManage ? (
          <Link
            href="/settings/integrations/new"
            className="inline-flex h-8 items-center rounded-control border border-primary bg-primary px-3 text-body font-medium text-white hover:bg-primary-hover"
          >
            {t("list.newConnection")}
          </Link>
        ) : undefined
      }
      flush
    >
      {connections.length === 0 ? (
        <EmptyState
          title={t("list.emptyTitle")}
          description={canManage ? t("list.emptyDescriptionAdmin") : t("list.emptyDescriptionReadOnly")}
        />
      ) : (
        <Table caption={t("list.tableCaption")}>
          <thead>
            <tr>
              <Th>{t("list.name")}</Th>
              <Th>{t("list.source")}</Th>
              <Th>{tc("word.status")}</Th>
              <Th>{t("list.lastSync")}</Th>
              <Th>{t("list.created")}</Th>
            </tr>
          </thead>
          <tbody>
            {connections.map((connection) => (
              <Tr key={connection.id}>
                <Td>
                  {canManage ? (
                    <Link
                      href={`/settings/integrations/${connection.id}`}
                      className="font-medium text-link hover:underline"
                    >
                      {connection.displayName}
                    </Link>
                  ) : (
                    <span className="font-medium text-text">{connection.displayName}</span>
                  )}
                </Td>
                <Td>{connection.isSandbox ? t("source.sandbox") : t("source.fhir")}</Td>
                <Td>
                  <Badge tone={CONNECTION_STATUS_TONE[connection.status]}>
                    {t(CONNECTION_STATUS_LABEL_KEYS[connection.status])}
                  </Badge>
                </Td>
                <Td className="tabular-nums">
                  {connection.lastSuccessAt ? format.dateTime(connection.lastSuccessAt) : t("list.never")}
                </Td>
                <Td className="tabular-nums">{format.dateOf(connection.createdAt)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  );
}
