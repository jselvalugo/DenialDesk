import { canManageIntegrations, canViewRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { AppShell } from "@/components/shell/AppShell";
import { withTenant } from "@/db/tenant";
import { connectionSummary } from "@/domain/integrations/connections";

/** Everything in this group requires a signed-in user with MFA and a practice. */
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  // The Patients data-source drop-down (specs/erp-shell.md): one indexed read of configuration,
  // never PHI or patient counts, so not audited.
  const patients = await withTenant(auth, (tx) => connectionSummary(tx, "patients"));
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
        canManageIntegrations: canManageIntegrations(auth.role),
        renderedAt: new Date().toISOString(),
      }}
    >
      {children}
    </AppShell>
  );
}
