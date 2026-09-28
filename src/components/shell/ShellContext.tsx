"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { PatientsConnectionSummary } from "@/domain/integrations/connections";
import { useT } from "@/i18n/client";
import { locate, navApps, type NavVisibility } from "./navigation";

export interface ShellData extends NavVisibility {
  /** Whether this user may manage integrations (Settings › Integrations, the data-source menu). */
  canManageIntegrations: boolean;
  /** The Patients connection summary (spec: erp-shell.md), fetched once by `AppShell`; no PHI. */
  patientsDataSource: PatientsConnectionSummary | null;
}

const ShellContext = createContext<ShellData | null>(null);

/** Carries which apps this user can open and the data-source summary, loaded once by `AppShell`. */
export function ShellProvider({ data, children }: { data: ShellData; children: ReactNode }) {
  return <ShellContext.Provider value={data}>{children}</ShellContext.Provider>;
}

/** Apps visible to this user plus the app and page for the current path; null outside the app shell. */
export function useShellLocation() {
  const data = useContext(ShellContext);
  const pathname = usePathname();
  const t = useT("shell");
  return useMemo(() => {
    if (!data) return null;
    const apps = navApps(data, t);
    return { apps, ...locate(apps, pathname) };
  }, [data, pathname, t]);
}

/** The raw shell data (data-source summary, manage flag); null outside the app shell. */
export function useShellData(): ShellData | null {
  return useContext(ShellContext);
}
