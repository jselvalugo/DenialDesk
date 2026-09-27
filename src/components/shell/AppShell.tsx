import type { ReactNode } from "react";
import { GlobalHeader, type ShellUser } from "./GlobalHeader";
import { SessionTimeout } from "./SessionTimeout";
import { ShellProvider } from "./ShellContext";

export function AppShell({
  user,
  showRevenueCycle = false,
  children,
}: {
  user: ShellUser | null;
  showRevenueCycle?: boolean;
  children: ReactNode;
}) {
  return (
    <ShellProvider visibility={{ showRevenueCycle, showSettings: user !== null }}>
      <div className="flex min-h-0 flex-1 flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:shadow-sm"
        >
          Skip to content
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
