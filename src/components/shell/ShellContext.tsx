"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { DataSourceSummary } from "@/domain/integrations/connections";
import { useT } from "@/i18n/client";
import { locate, navApps, type NavVisibility } from "./navigation";

/**
 * Where each synced table's data comes from (specs/erp-shell.md "Data-source drop-down"): loaded once
 * per page by the signed-in layout. `undefined` means not loaded (e.g. the style guide), so no
 * drop-down renders; `null` means manual. Configuration only, no PHI.
 */
export interface ShellDataSources {
  patients?: DataSourceSummary | null;
  /** Shows the administrator links in the drop-down. Not access control: every page re-checks. */
  canManageIntegrations: boolean;
  /** When the server rendered the page, so relative times match between server and browser. */
  renderedAt: string;
}

interface ShellState {
  visibility: NavVisibility;
  dataSources?: ShellDataSources;
}

const ShellContext = createContext<ShellState | null>(null);

/** Carries which apps this user can open, so the header and page headers agree on the current app. */
export function ShellProvider({
  visibility,
  dataSources,
  children,
}: {
  visibility: NavVisibility;
  dataSources?: ShellDataSources;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ visibility, dataSources }), [visibility, dataSources]);
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

/** Apps visible to this user plus the app and page for the current path; null outside the app shell. */
export function useShellLocation() {
  const state = useContext(ShellContext);
  const pathname = usePathname();
  const t = useT("shell");
  return useMemo(() => {
    if (!state) return null;
    const apps = navApps(state.visibility, t);
    return { apps, ...locate(apps, pathname) };
  }, [state, pathname, t]);
}

/** The data-source summaries for the drop-down; undefined outside a signed-in practice page. */
export function useShellDataSources(): ShellDataSources | undefined {
  return useContext(ShellContext)?.dataSources;
}
