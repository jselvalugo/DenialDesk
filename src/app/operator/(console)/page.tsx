import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/auth/operator";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { primaryLinkButtonClass, secondaryLinkButtonClass } from "@/components/ui/linkButton";
import { StatTile } from "@/components/ui/StatTile";
import { listPractices } from "@/domain/platform/practices";
import { getFormat, getT } from "@/i18n/server";
import { auditSystem } from "@/lib/audit";
import { AgreementStatusBadge } from "./AgreementStatusBadge";
import { SuspendToggle } from "./controls";

export async function generateMetadata(): Promise<Metadata> {
  const tShell = await getT("shell");
  return { title: tShell("operator.console") };
}

export default async function OperatorPage() {
  const operator = await requireOperator();
  const practices = await listPractices(operator);
  await auditSystem({
    action: "operator.console_viewed",
    actorUserId: operator.userId,
    metadata: { count: practices.length },
  });

  const t = await getT("operator");
  const tc = await getT("common");
  const f = await getFormat();

  const customers = practices.filter((p) => p.kind === "customer");
  const active = customers.filter((p) => !p.suspendedAt);
  const withoutBaa = customers.filter((p) => p.baa !== "active" && p.baa !== "expiring");

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <PageHeader
        title={t("list.title")}
        description={t("list.description")}
        actions={
          <>
            <Link href="/operator/integrations" className={secondaryLinkButtonClass}>
              {t("integrations.link")}
            </Link>
            <Link href="/operator/practices/new" className={primaryLinkButtonClass}>
              {t("list.newPractice")}
            </Link>
          </>
        }
      />

      <section aria-label={t("list.totalsLabel")} className="grid grid-cols-5 gap-4">
        <StatTile label={t("list.stat.customers")} value={f.number(customers.length)} />
        <StatTile label={t("status.active")} value={f.number(active.length)} />
        <StatTile
          label={t("status.suspended")}
          value={f.number(customers.length - active.length)}
          emphasis={customers.length - active.length > 0 ? "warning" : undefined}
        />
        <StatTile
          label={t("list.stat.withoutBaa")}
          value={f.number(withoutBaa.length)}
          emphasis={withoutBaa.length > 0 ? "warning" : undefined}
        />
        <StatTile
          label={t("list.stat.openDenials")}
          value={f.number(practices.reduce((sum, p) => sum + p.openDenials, 0))}
        />
      </section>

      <Panel title={t("list.panelTitle")} flush>
        <Table caption={t("list.tableCaption")}>
          <thead>
            <tr>
              <Th>{tc("word.practice")}</Th>
              <Th>{tc("word.type")}</Th>
              <Th>{tc("word.status")}</Th>
              <Th>{t("list.columns.baa")}</Th>
              <Th numeric>{t("list.columns.team")}</Th>
              <Th numeric>{t("list.columns.openDenials")}</Th>
              <Th>{tc("word.created")}</Th>
              <Th className="text-right">{tc("word.actions")}</Th>
            </tr>
          </thead>
          <tbody>
            {practices.map((practice) => (
              <Tr key={practice.id}>
                <Td className="font-medium">
                  <Link href={`/operator/practices/${practice.id}`} className="text-link hover:underline">
                    {practice.name}
                  </Link>
                </Td>
                <Td>
                  <Badge tone={practice.kind === "demo" ? "info" : "neutral"} dot={false}>
                    {practice.kind === "demo" ? t("status.demo") : t("status.customer")}
                  </Badge>
                </Td>
                <Td>
                  {practice.suspendedAt ? (
                    <Badge tone={practice.kind === "demo" ? "neutral" : "danger"}>
                      {practice.kind === "demo" ? t("status.archived") : t("status.suspended")}
                    </Badge>
                  ) : (
                    <Badge tone="success">{t("status.active")}</Badge>
                  )}
                </Td>
                <Td>
                  {practice.baa ? (
                    <AgreementStatusBadge status={practice.baa} />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </Td>
                <Td numeric>{f.number(practice.teamSize)}</Td>
                <Td numeric>{f.number(practice.openDenials)}</Td>
                <Td className="tabular text-muted">{f.dateOf(practice.createdAt)}</Td>
                <Td className="text-right">
                  {practice.kind === "customer" && (
                    <SuspendToggle
                      tenantId={practice.id}
                      suspended={!!practice.suspendedAt}
                      name={practice.name}
                    />
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}
