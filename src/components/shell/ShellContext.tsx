"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { locate, navApps, type NavVisibility } from "./navigation";

const ShellContext = createContext<NavVisibility | null>(null);

/** Carries which apps this user can open, so the header and page headers agree on the current app. */
export function ShellProvider({ visibility, children }: { visibility: NavVisibility; children: ReactNode }) {
  return <ShellContext.Provider value={visibility}>{children}</ShellContext.Provider>;
}

/** Apps visible to this user plus the app and page for the current path; null outside the app shell. */
export function useShellLocation() {
  const visibility = useContext(ShellContext);
  const pathname = usePathname();
  return useMemo(() => {
    if (!visibility) return null;
    const apps = navApps(visibility);
    return { apps, ...locate(apps, pathname) };
  }, [visibility, pathname]);
}
