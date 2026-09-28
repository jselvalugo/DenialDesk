import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/auth/operator";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { auditIntegrationViewed, listPendingApprovals } from "@/domain/integrations/approval";
import { getFormat, getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("operator");
  return { title: t("integrations.metaTitle") };
}

/**
 * The operator's queue of real EHR/PM connections awaiting approval, across practices, oldest
 * submission first (docs/specs/patient-integrations.md PI1c). Configuration only: no PHI.
 */
export default async function IntegrationApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ decided?: string }>;
}) {
  const operator = await requireOperator();
  const pending = await listPendingApprovals(operator);
  await auditIntegrationViewed(operator, { count: pending.length });
  const { decided } = await searchParams;
  const t = await getT("operator");
  const tc = await getT("common");
  const f = await getFormat();

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <PageHeader
        title={t("integrations.title")}
        description={t("integrations.description")}
        actions={
          <Link href="/operator" className="text-body font-medium text-link hover:underline">
            {t("nav.allPractices")}
          </Link>
        }
      />

      {(decided === "approved" || decided === "rejected") && (
        <p
          role="status"
          className="rounded-panel border border-success-border bg-success-bg p-3 text-body text-success-fg"
        >
          {decided === "approved" ? t("integrations.approve.done") : t("integrations.reject.done")}
        </p>
      )}

      <Panel title={t("integrations.panelTitle")} flush>
        {pending.length === 0 ? (
          <p className="p-4 text-body text-muted">{t("integrations.empty")}</p>
        ) : (
          <Table caption={t("integrations.tableCaption")}>
            <thead>
              <tr>
                <Th>{tc("word.practice")}</Th>
                <Th>{t("integrations.columns.name")}</Th>
                <Th>{t("integrations.columns.baseUrl")}</Th>
                <Th>{t("integrations.columns.clientId")}</Th>
                <Th>{t("integrations.columns.submitted")}</Th>
                <Th className="text-right">{tc("word.actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {pending.map((item) => (
                <Tr key={item.connectionId}>
                  <Td className="font-medium">
                    <Link
                      href={`/operator/practices/${item.practiceId}`}
                      className="text-link hover:underline"
                    >
                      {item.practiceName}
                    </Link>
                  </Td>
                  <Td>{item.displayName}</Td>
                  <Td className="font-mono break-all">{item.baseUrl}</Td>
                  <Td className="font-mono break-all">{item.clientId}</Td>
                  <Td className="tabular text-muted">
                    {item.submittedAt ? f.dateOf(item.submittedAt) : "—"}
                  </Td>
                  <Td className="text-right">
                    <Link
                      href={`/operator/practices/${item.practiceId}/integrations/${item.connectionId}`}
                      className="font-medium text-link hover:underline"
                    >
                      {t("integrations.review")}
                    </Link>
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
