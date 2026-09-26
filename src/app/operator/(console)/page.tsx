import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/auth/operator";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { primaryLinkButtonClass } from "@/components/ui/linkButton";
import { StatTile } from "@/components/ui/StatTile";
import { listPractices } from "@/domain/platform/practices";
import { auditSystem } from "@/lib/audit";
import { AgreementStatusBadge } from "./AgreementStatusBadge";
import { SuspendToggle } from "./controls";

export const metadata: Metadata = { title: "Platform console" };

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "2-digit",
  day: "2-digit",
  year: "numeric",
  timeZone: "America/New_York",
});

export default async function OperatorPage() {
  const operator = await requireOperator();
  const practices = await listPractices(operator);
  await auditSystem({
    action: "operator.console_viewed",
    actorUserId: operator.userId,
    metadata: { count: practices.length },
  });

  const customers = practices.filter((p) => p.kind === "customer");
  const active = customers.filter((p) => !p.suspendedAt);
  const withoutBaa = customers.filter((p) => p.baa !== "active" && p.baa !== "expiring");

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <PageHeader
        title="Practices"
        description="Every practice on this DenialDesk environment. Practice-level details only; patient data stays inside each practice."
        actions={
          <Link href="/operator/practices/new" className={primaryLinkButtonClass}>
            New practice
          </Link>
        }
      />

      <section aria-label="Platform totals" className="grid grid-cols-5 gap-4">
        <StatTile label="Customer practices" value={customers.length} />
        <StatTile label="Active" value={active.length} />
        <StatTile
          label="Suspended"
          value={customers.length - active.length}
          emphasis={customers.length - active.length > 0 ? "warning" : undefined}
        />
        <StatTile
          label="Without a current BAA"
          value={withoutBaa.length}
          emphasis={withoutBaa.length > 0 ? "warning" : undefined}
        />
        <StatTile
          label="Open denials (all practices)"
          value={practices.reduce((sum, p) => sum + p.openDenials, 0)}
        />
      </section>

      <Panel title="All practices" flush>
        <Table caption="All practices on this environment">
          <thead>
            <tr>
              <Th>Practice</Th>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th>BAA</Th>
              <Th numeric>Team</Th>
              <Th numeric>Open denials</Th>
              <Th>Created</Th>
              <Th className="text-right">Actions</Th>
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
                    {practice.kind === "demo" ? "Demo" : "Customer"}
                  </Badge>
                </Td>
                <Td>
                  {practice.suspendedAt ? (
                    <Badge tone={practice.kind === "demo" ? "neutral" : "danger"}>
                      {practice.kind === "demo" ? "Archived" : "Suspended"}
                    </Badge>
                  ) : (
                    <Badge tone="success">Active</Badge>
                  )}
                </Td>
                <Td>
                  {practice.baa ? (
                    <AgreementStatusBadge status={practice.baa} />
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </Td>
                <Td numeric>{practice.teamSize}</Td>
                <Td numeric>{practice.openDenials}</Td>
                <Td className="tabular text-muted">{dateFormat.format(practice.createdAt)}</Td>
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
