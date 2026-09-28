import { canManageIntegrations, canViewRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { AppShell } from "@/components/shell/AppShell";

/** Everything in this group requires a signed-in user with MFA and a practice. */
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  return (
    <AppShell
      user={{
        displayName: auth.displayName,
        tenantName: auth.tenantName,
        role: auth.role,
      }}
      tenantId={auth.tenantId}
      userId={auth.userId}
      canManageIntegrations={canManageIntegrations(auth.role)}
      showRevenueCycle={canViewRevenueCycle(auth.role)}
    >
      {children}
    </AppShell>
  );
}
