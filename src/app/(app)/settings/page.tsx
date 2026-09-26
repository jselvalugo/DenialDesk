import type { Metadata } from "next";
import { canConfigureSettings } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { isProduction, syntheticDataOnly } from "@/lib/env";

export const metadata: Metadata = { title: "Settings" };

const roleLabels = {
  admin: "Administrator",
  manager: "Manager",
  specialist: "Billing specialist",
  compliance: "Compliance",
} as const;

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-4 border-b border-border py-3 last:border-b-0">
      <dt className="text-label font-medium text-muted">{term}</dt>
      <dd className="text-body text-text">{children}</dd>
    </div>
  );
}

export default async function GeneralSettingsPage() {
  const auth = await requireAuth();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Practice profile" description="Set when DenialDesk created your practice.">
        <dl>
          <Row term="Practice name">{auth.tenantName}</Row>
          <Row term="Environment">
            {isProduction() ? (
              "Production"
            ) : (
              <Badge tone="warning">
                Pre-production{syntheticDataOnly() ? " · synthetic data only" : ""}
              </Badge>
            )}
          </Row>
          <Row term="Data residency">United States only</Row>
        </dl>
        <p className="mt-3 text-label text-muted">To change the practice name, contact DenialDesk support.</p>
      </Panel>
      <Panel title="Your account" description="The user you are signed in as.">
        <dl>
          <Row term="Name">{auth.displayName}</Row>
          <Row term="Email">{auth.email}</Row>
          <Row term="Role">{roleLabels[auth.role]}</Row>
          <Row term="Can change settings">{canConfigureSettings(auth.role) ? "Yes" : "No: view only"}</Row>
        </dl>
      </Panel>
    </div>
  );
}
