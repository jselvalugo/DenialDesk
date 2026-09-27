import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canConfigureRevenueCycle, canViewRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { describeMatch, ruleMatchSchema } from "@/domain/revenue-cycle/engine";
import { ledgerSetup } from "@/domain/revenue-cycle/setup";
import type { MessageKey } from "@/i18n/messages/types";
import { getT } from "@/i18n/server";
import { LoadDefaults } from "./LoadDefaults";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("revenue");
  return { title: t("rules.title") };
}

const kindLabelKeys = {
  cash: "rules.kind.cash",
  ar: "rules.kind.ar",
  revenue: "rules.kind.revenue",
  adjustment: "rules.kind.adjustment",
} as const satisfies Record<string, MessageKey<"revenue">>;

export default async function RulesPage() {
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  const t = await getT("revenue");
  const { rules, accounts, classes, sites } = await withTenant(auth, (tx) => ledgerSetup(tx));
  const accountName = new Map(accounts.map((a) => [a.number, a.name]));
  const gl = (number: string | null, fallback: string) =>
    number ? (
      <span title={accountName.get(number)}>
        <Code>{number}</Code>
      </span>
    ) : (
      <span className="text-label text-subtle">{fallback}</span>
    );

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader title={t("rules.title")} description={t("rules.description")} />

      {rules.length === 0 ? (
        <Panel>
          <EmptyState
            title={t("rules.emptyTitle")}
            description={t("rules.emptyDescription")}
            action={
              canConfigureRevenueCycle(auth.role) ? (
                <LoadDefaults />
              ) : (
                <p className="text-body text-muted">{t("rules.askAdmin")}</p>
              )
            }
          />
        </Panel>
      ) : (
        <Panel
          title={t("rules.businessRulesTitle")}
          description={t("rules.businessRulesDescription", { count: rules.length })}
          flush
        >
          <Table caption={t("rules.tableCaption")}>
            <thead>
              <tr>
                <Th numeric>#</Th>
                <Th>{t("rules.col.rule")}</Th>
                <Th>{t("rules.col.matchesWhen")}</Th>
                <Th>{t("rules.col.ar")}</Th>
                <Th>{t("rules.col.revenue")}</Th>
                <Th>{t("rules.col.adjustment")}</Th>
                <Th>{t("rules.col.status")}</Th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => {
                const match = ruleMatchSchema.safeParse(rule.match);
                return (
                  <Tr key={rule.id}>
                    <Td numeric className="align-top">
                      {rule.priority}
                    </Td>
                    <Td className="align-top">
                      <p className="font-medium text-text">{rule.name}</p>
                      <p className="mt-0.5">
                        <Code>{rule.code}</Code>
                      </p>
                      <p className="mt-1 max-w-sm text-label text-muted">{rule.description}</p>
                    </Td>
                    <Td className="align-top">
                      {match.success ? (
                        <ul className="space-y-0.5">
                          {describeMatch(match.data, t).map((text) => (
                            <li key={text}>{text}</li>
                          ))}
                        </ul>
                      ) : (
                        <Badge tone="danger">{t("rules.invalidConditions")}</Badge>
                      )}
                    </Td>
                    <Td className="align-top">{gl(rule.arGl, t("rules.payerClassOrDefault"))}</Td>
                    <Td className="align-top">{gl(rule.revenueGl, t("rules.fromArAccount"))}</Td>
                    <Td className="align-top">{gl(rule.adjustmentGl, t("rules.fromArAccount"))}</Td>
                    <Td className="align-top">
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={rule.active ? "success" : "neutral"}>
                          {rule.active ? t("rules.active") : t("rules.inactive")}
                        </Badge>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          <p className="border-t border-border px-4 py-2.5 text-label text-muted">
            {t("rules.source", { source: rules[0]!.source })}
          </p>
        </Panel>
      )}

      {accounts.length > 0 && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title={t("rules.glAccountsTitle")} description={t("rules.glAccountsDescription")} flush>
            <Table caption={t("rules.glAccountsTitle")}>
              <thead>
                <tr>
                  <Th>{t("rules.col.account")}</Th>
                  <Th>{t("rules.col.name")}</Th>
                  <Th>{t("rules.col.type")}</Th>
                  <Th>{t("rules.col.postsTo")}</Th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <Tr key={a.id}>
                    <Td>
                      <Code>{a.number}</Code>
                    </Td>
                    <Td>
                      {a.name}
                      {a.isDefaultAr && (
                        <span className="ml-2">
                          <Badge tone="info">{t("rules.defaultAr")}</Badge>
                        </span>
                      )}
                    </Td>
                    <Td className="text-muted">{t(kindLabelKeys[a.kind])}</Td>
                    <Td>
                      {a.kind === "ar" ? (
                        <span className="flex gap-1.5">
                          <Code>{a.revenueGl}</Code>
                          <Code>{a.adjustmentGl}</Code>
                        </span>
                      ) : (
                        <span className="text-subtle">—</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Panel>

          <div className="flex flex-col gap-6">
            <Panel
              title={t("rules.payerClassesTitle")}
              description={t("rules.payerClassesDescription")}
              flush
            >
              <Table caption={t("rules.payerClassesTitle")}>
                <thead>
                  <tr>
                    <Th>{t("rules.col.class")}</Th>
                    <Th>{t("rules.col.name")}</Th>
                    <Th>{t("rules.col.denialDeskPayer")}</Th>
                    <Th>{t("rules.col.arAccount")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {classes.map((pc) => (
                    <Tr key={pc.id}>
                      <Td>
                        <Code>{pc.code}</Code>
                      </Td>
                      <Td>{pc.name}</Td>
                      <Td className={pc.payerName ? "" : "text-subtle"}>
                        {pc.payerName ?? t("rules.notLinked")}
                      </Td>
                      <Td>{gl(pc.arGl, t("rules.default"))}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Panel>

            <Panel title={t("rules.sitesTitle")} description={t("rules.sitesDescription")} flush>
              {sites.length === 0 ? (
                <EmptyState title={t("rules.noSitesTitle")} description={t("rules.noSitesDescription")} />
              ) : (
                <Table caption={t("rules.sitesTitle")}>
                  <thead>
                    <tr>
                      <Th>{t("rules.col.site")}</Th>
                      <Th>{t("rules.col.name")}</Th>
                      <Th>{t("rules.col.location")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sites.map((site) => (
                      <Tr key={site.id}>
                        <Td>
                          <Code>{site.code}</Code>
                        </Td>
                        <Td>{site.name}</Td>
                        <Td className="text-muted">{site.locationName ?? "—"}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
