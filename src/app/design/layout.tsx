import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { isProduction } from "@/lib/env";

/** The style guide contains no practice data, so it doesn't require sign-in; it never ships to production. */
export default function DesignLayout({ children }: { children: React.ReactNode }) {
  if (isProduction()) notFound();
  return (
    <AppShell user={null} showDesignSystem>
      {children}
    </AppShell>
  );
}
