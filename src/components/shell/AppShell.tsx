import type { ReactNode } from "react";
import { SessionTimeout } from "./SessionTimeout";
import { Sidebar } from "./Sidebar";
import { TopBar, type ShellUser } from "./TopBar";

export function AppShell({
  user,
  showDesignSystem,
  children,
}: {
  user: ShellUser | null;
  showDesignSystem: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:shadow-sm"
      >
        Skip to content
      </a>
      <Sidebar showDesignSystem={showDesignSystem} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} />
        <main
          id="main"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto bg-canvas px-6 py-6 focus:outline-none"
        >
          {children}
        </main>
      </div>
      {user && <SessionTimeout />}
    </div>
  );
}
