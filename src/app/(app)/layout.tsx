import { canManageIntegrations, canViewRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { AppShell } from "@/components/shell/AppShell";
import { summaryForRole } from "@/components/shell/data-source";
import { withTenant } from "@/db/tenant";
import { connectionSummary, type DataSourceSummary } from "@/domain/integrations/connections";
import { log } from "@/lib/log";

/** Everything in this group requires a signed-in user with MFA and a practice. */
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  const canManage = canManageIntegrations(auth.role);
  // The Patients data-source drop-down (specs/erp-shell.md): one read of configuration, never PHI or
  // patient counts, so not audited. A failure hides the drop-down (undefined) rather than taking
  // every signed-in page down with it.
  let patients: DataSourceSummary | null | undefined;
  try {
    const summary = await withTenant(auth, (tx) => connectionSummary(tx, "patients"));
    patients = summaryForRole(summary, canManage);
  } catch {
    log.error("shell.data_source_unavailable", { tenantId: auth.tenantId });
    patients = undefined;
  }
  return (
    <AppShell
      user={{
        displayName: auth.displayName,
        tenantName: auth.tenantName,
        role: auth.role,
      }}
      showRevenueCycle={canViewRevenueCycle(auth.role)}
      dataSources={{
        patients,
        canManageIntegrations: canManage,
        renderedAt: new Date().toISOString(),
      }}
    >
      {children}
    </AppShell>
  );
}
