import { isPlatformOperator } from "@/auth/operator";
import { requireAuth } from "@/auth/session";
import { AppShell } from "@/components/shell/AppShell";
import { isProduction } from "@/lib/env";

/** Everything in this group requires a signed-in user with MFA (or a demo session) and a practice. */
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  return (
    <AppShell
      user={{
        displayName: auth.displayName,
        tenantName: auth.tenantName,
        role: auth.role,
        demo: auth.tenantKind === "demo",
      }}
      showDesignSystem={!isProduction()}
      showOperatorConsole={isPlatformOperator(auth)}
    >
      {children}
    </AppShell>
  );
}
