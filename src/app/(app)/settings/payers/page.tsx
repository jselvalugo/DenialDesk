import type { Metadata } from "next";
import Link from "next/link";
import { requireAuth } from "@/auth/session";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { ListCell } from "@/components/custom-fields/ListCell";
import { withTenant } from "@/db/tenant";
import { regimeLabel } from "@/domain/denial-status";
import { loadListValues } from "@/domain/custom-fields/list-values";
import { listPayers } from "@/domain/payers/queries";
import { payerSourceLabel } from "@/domain/payers/source-label";
import { getT } from "@/i18n/server";

// Read-only payer list under Settings (docs/specs/settings-and-custom-fields.md S2 PR4;
// docs/specs/payer-catalog.md). Every practice role may view it, same as the rest of Settings
// (requireAuth only, no further role gate); payer names, EDI payer IDs, and regimes are public or
// internal reference data, not PHI.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("payers.metaTitle") };
}

export default async function PayersPage() {
  const auth = await requireAuth();
  const t = await getT("settings");
  const tc = await getT("common");

  const { rows, listColumns, listValues } = await withTenant(auth, async (tx) => {
    const rows = await listPayers(tx);
    const { columns, valuesByRecord } = await loadListValues(
      tx,
      auth,
      "payer",
      rows.map((r) => r.id),
    );
    return { rows, listColumns: columns, listValues: valuesByRecord };
  });

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <Panel
        title={t("payers.listTitle")}
        description={t("payers.listDescription")}
        actions={
          <span className="text-label text-muted tabular">{t("payers.count", { count: rows.length })}</span>
        }
        flush
      >
        {rows.length === 0 ? (
          <EmptyState title={t("payers.emptyTitle")} description={t("payers.emptyDescription")} />
        ) : (
          <Table caption={t("payers.tableCaption")}>
            <thead>
              <tr>
                <Th>{tc("word.name")}</Th>
                <Th>{t("payers.ediPayerId")}</Th>
                <Th>{t("payers.field.regime")}</Th>
                <Th>{t("payers.source")}</Th>
                {listColumns.map((col) => (
                  <Th key={col.fieldId}>{col.label}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((payer) => (
                <Tr key={payer.id}>
                  <Td className="font-medium">
                    <Link href={`/settings/payers/${payer.id}`} className="text-link hover:underline">
                      {payer.name}
                    </Link>
                  </Td>
                  <Td>
                    {payer.ediPayerId ? (
                      <Code>{payer.ediPayerId}</Code>
                    ) : (
                      <span className="text-muted">{t("payers.notVerified")}</span>
                    )}
                  </Td>
                  <Td>{regimeLabel(payer.regime, tc)}</Td>
                  <Td className="text-muted">{payerSourceLabel(payer.source, t)}</Td>
                  {listColumns.map((col) => (
                    <Td key={col.fieldId}>
                      <ListCell type={col.type} value={listValues.get(payer.id)?.get(col.key)} />
                    </Td>
                  ))}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
