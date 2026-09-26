import type { ReactNode } from "react";
import { PreviewBanner } from "./PreviewBanner";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell({ appEnv, children }: { appEnv: string; children: ReactNode }) {
  const isProduction = appEnv === "production";
  return (
    <div className="flex h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-control focus:bg-surface focus:px-3 focus:py-2 focus:shadow-sm"
      >
        Skip to content
      </a>
      {!isProduction && <PreviewBanner appEnv={appEnv} />}
      <div className="flex min-h-0 flex-1">
        <Sidebar showDesignSystem={!isProduction} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main
            id="main"
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto bg-canvas px-6 py-6 focus:outline-none"
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
