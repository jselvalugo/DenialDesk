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
import { LoadDefaults } from "./LoadDefaults";

export const metadata: Metadata = { title: "Rules and ledger" };

const kindLabels = { cash: "Cash", ar: "Accounts receivable", revenue: "Revenue", adjustment: "Adjustment" };

export default async function RulesPage() {
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
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
      <PageHeader
        title="Rules and ledger"
        description="Which general-ledger accounts each line of the monthly activity file posts to. The first active rule that matches wins; amounts always post as the practice-management system recorded them."
      />

      {rules.length === 0 ? (
        <Panel>
          <EmptyState
            title="No accounting rules yet"
            description="Load DenialDesk's starter configuration (rules, a chart of accounts, one payer class per payer type, and one site per location) to start processing monthly files. Review every rule and map the accounts to your general ledger before the first import."
            action={
              canConfigureRevenueCycle(auth.role) ? (
                <LoadDefaults />
              ) : (
                <p className="text-body text-muted">Ask an administrator to load it.</p>
              )
            }
          />
        </Panel>
      ) : (
        <Panel title="Business rules" description={`${rules.length} rules, evaluated in order`} flush>
          <Table caption="Business rules in evaluation order">
            <thead>
              <tr>
                <Th numeric>#</Th>
                <Th>Rule</Th>
                <Th>Matches when</Th>
                <Th>AR</Th>
                <Th>Revenue</Th>
                <Th>Adjustment</Th>
                <Th>Status</Th>
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
                          {describeMatch(match.data).map((text) => (
                            <li key={text}>{text}</li>
                          ))}
                        </ul>
                      ) : (
                        <Badge tone="danger">Invalid conditions</Badge>
                      )}
                    </Td>
                    <Td className="align-top">{gl(rule.arGl, "Payer class or default")}</Td>
                    <Td className="align-top">{gl(rule.revenueGl, "From AR account")}</Td>
                    <Td className="align-top">{gl(rule.adjustmentGl, "From AR account")}</Td>
                    <Td className="align-top">
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={rule.active ? "success" : "neutral"}>
                          {rule.active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          <p className="border-t border-border px-4 py-2.5 text-label text-muted">
            Source: {rules[0]!.source}. These are the practice&apos;s accounting policies, not payer or legal
            rules.
          </p>
        </Panel>
      )}

      {accounts.length > 0 && (
        <div className="grid gap-6 xl:grid-cols-2">
          <Panel title="GL accounts" description="Chart of accounts used for journal vouchers" flush>
            <Table caption="GL accounts">
              <thead>
                <tr>
                  <Th>Account</Th>
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>Posts revenue / adjustments to</Th>
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
                          <Badge tone="info">Default AR</Badge>
                        </span>
                      )}
                    </Td>
                    <Td className="text-muted">{kindLabels[a.kind]}</Td>
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
            <Panel title="Payer classes" description="Linked to DenialDesk payers where one matches" flush>
              <Table caption="Payer classes">
                <thead>
                  <tr>
                    <Th>Class</Th>
                    <Th>Name</Th>
                    <Th>DenialDesk payer</Th>
                    <Th>AR account</Th>
                  </tr>
                </thead>
                <tbody>
                  {classes.map((pc) => (
                    <Tr key={pc.id}>
                      <Td>
                        <Code>{pc.code}</Code>
                      </Td>
                      <Td>{pc.name}</Td>
                      <Td className={pc.payerName ? "" : "text-subtle"}>{pc.payerName ?? "Not linked"}</Td>
                      <Td>{gl(pc.arGl, "Default")}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Panel>

            <Panel title="Sites" description="Cost centers on journal vouchers" flush>
              {sites.length === 0 ? (
                <EmptyState
                  title="No sites"
                  description="Add practice locations first; each location becomes an accounting site."
                />
              ) : (
                <Table caption="Accounting sites">
                  <thead>
                    <tr>
                      <Th>Site</Th>
                      <Th>Name</Th>
                      <Th>Location</Th>
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
