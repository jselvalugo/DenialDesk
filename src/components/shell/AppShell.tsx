import type { ReactNode } from "react";
import { GlobalHeader, type ShellUser } from "./GlobalHeader";
import { SessionTimeout } from "./SessionTimeout";
import { ShellProvider } from "./ShellContext";

export function AppShell({
  user,
  showDesignSystem,
  showRevenueCycle = false,
  children,
}: {
  user: ShellUser | null;
  showDesignSystem: boolean;
  showRevenueCycle?: boolean;
  children: ReactNode;
}) {
  return (
    <ShellProvider visibility={{ showDesignSystem, showRevenueCycle }}>
      <div className="flex min-h-0 flex-1 flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:shadow-sm"
        >
          Skip to content
        </a>
        <GlobalHeader user={user} />
        {user?.demo && (
          <p
            role="note"
            aria-label="Demo practice notice"
            className="border-b border-info-border bg-info-bg px-6 py-2 text-label font-medium text-info-fg"
          >
            Shared demo practice: other visitors can see anything you type here. Never enter real patient
            information.
          </p>
        )}
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
