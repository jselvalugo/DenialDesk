import type { ReactNode } from "react";
import { getT } from "@/i18n/server";
import { loadPatientsConnectionSummary } from "./connection-summary";
import { GlobalHeader, type ShellUser } from "./GlobalHeader";
import { SessionTimeout } from "./SessionTimeout";
import { ShellProvider } from "./ShellContext";

export async function AppShell({
  user,
  tenantId,
  userId,
  canManageIntegrations = false,
  showRevenueCycle = false,
  children,
}: {
  user: ShellUser | null;
  /** Present for a signed-in practice user: loads the Patients data-source summary (one query). */
  tenantId?: string;
  userId?: string;
  canManageIntegrations?: boolean;
  showRevenueCycle?: boolean;
  children: ReactNode;
}) {
  const t = await getT("shell");
  // One cheap, tenant-scoped, indexed read (spec: erp-shell.md "Data-source drop-down"); no PHI,
  // no patient counts, nothing placed in a URL or client storage (R-7.4.8).
  // `loadPatientsConnectionSummary` is request-memoized (React `cache()`): the Patients pages
  // load the same summary again for their own "synced from …" notice, and share this one query
  // rather than running it twice per request (security/correctness review PR #81, item 18).
  const patientsDataSource = tenantId && userId ? await loadPatientsConnectionSummary() : null;
  return (
    <ShellProvider
      data={{
        showRevenueCycle,
        showSettings: user !== null,
        canManageIntegrations,
        patientsDataSource,
      }}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:shadow-sm"
        >
          {t("skipToContent")}
        </a>
        <GlobalHeader user={user} />
        <main
          id="main"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto bg-canvas px-6 py-6 focus:outline-none max-lg:px-4"
        >
          {children}
        </main>
      </div>
      {user && <SessionTimeout />}
    </ShellProvider>
  );
}
