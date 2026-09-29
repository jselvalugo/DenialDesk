import type { Metadata } from "next";
import Link from "next/link";
import { canManageAppealTemplates } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { listTemplateStatus } from "@/domain/appeals/letter/queries";
import { CATEGORY_LABEL_KEYS } from "@/domain/carc";
import { getFormat, getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("appealTemplates.metaTitle") };
}

export default async function AppealTemplatesPage() {
  const auth = await requireAuth();
  const t = await getT("settings");
  const tc = await getT("common");
  const f = await getFormat();
  const canEdit = canManageAppealTemplates(auth.role);
  const rows = await withTenant(auth, (tx) => listTemplateStatus(tx));

  return (
    <Panel title={t("appealTemplates.panelTitle")} description={t("appealTemplates.panelDescription")} flush>
      <Table caption={t("appealTemplates.tableCaption")}>
        <thead>
          <tr>
            <Th>{tc("word.category")}</Th>
            <Th>{t("appealTemplates.source")}</Th>
            <Th>{t("appealTemplates.lastEdited")}</Th>
            <Th className="text-right">{tc("word.actions")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const category = tc(CATEGORY_LABEL_KEYS[row.category]);
            return (
              <Tr key={row.category}>
                <Td className="font-medium text-text">{category}</Td>
                <Td>
                  <Badge tone={row.source === "practice" ? "success" : "neutral"}>
                    {row.source === "practice"
                      ? t("appealTemplates.sourcePractice")
                      : t("appealTemplates.sourceStarter")}
                  </Badge>
                </Td>
                <Td>
                  {row.updatedAt && row.updatedBy ? `${row.updatedBy} · ${f.dateTime(row.updatedAt)}` : "—"}
                </Td>
                <Td className="text-right">
                  <Link
                    href={`/settings/appeal-templates/${row.category}`}
                    className="inline-flex h-7 items-center text-label font-medium text-link hover:underline"
                    aria-label={t(canEdit ? "appealTemplates.editAria" : "appealTemplates.viewAria", {
                      category,
                    })}
                  >
                    {canEdit ? tc("action.edit") : tc("action.view")}
                  </Link>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </Panel>
  );
}
