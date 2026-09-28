import type { ReactNode } from "react";
import { getT } from "@/i18n/server";
import { GlobalHeader, type ShellUser } from "./GlobalHeader";
import { SessionTimeout } from "./SessionTimeout";
import { ShellProvider, type ShellDataSources } from "./ShellContext";

export async function AppShell({
  user,
  showRevenueCycle = false,
  dataSources,
  children,
}: {
  user: ShellUser | null;
  showRevenueCycle?: boolean;
  /** Loaded by the signed-in layout (one indexed query); absent in the style guide. */
  dataSources?: ShellDataSources;
  children: ReactNode;
}) {
  const t = await getT("shell");
  return (
    <ShellProvider visibility={{ showRevenueCycle, showSettings: user !== null }} dataSources={dataSources}>
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
