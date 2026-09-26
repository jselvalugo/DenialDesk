"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Grip, Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { AppIcon, AppLauncher } from "./AppLauncher";
import { useShellLocation } from "./ShellContext";
import { UserMenu, type ShellUser } from "./UserMenu";

export type { ShellUser };

/**
 * ERP-style chrome (DESIGN.md §8): a white global header (logo, search, practice, user) over a navy
 * app bar (launcher, current app, and its pages as tabs).
 */
export function GlobalHeader({ user }: { user: ShellUser | null }) {
  const location = useShellLocation();
  const [launcherOpen, setLauncherOpen] = useState(false);

  // Ctrl+K / ⌘K opens the launcher from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Leave the shortcut to text fields and editors that have focus.
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setLauncherOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!location) return null;
  const { apps, app, item: current } = location;
  const tabs = app.items.filter((item) => item.available);

  return (
    <header className="shrink-0">
      <div className="flex h-14 items-center gap-6 border-b border-border bg-surface px-4">
        <Link href="/" aria-label="DenialDesk home" className="shrink-0">
          <Image src="/brand/denialdesk-logo.png" alt="DenialDesk" width={140} height={33} priority />
        </Link>

        <button
          type="button"
          onClick={() => setLauncherOpen(true)}
          className="group mx-auto flex h-9 w-full min-w-40 max-w-md items-center gap-2.5 rounded-control border border-border bg-surface-muted px-3 text-left text-body text-subtle transition-colors duration-100 hover:border-border-strong hover:bg-surface"
        >
          <Search aria-hidden="true" className="size-4 shrink-0" />
          <span className="flex-1 truncate">Search apps and pages</span>
          <kbd
            aria-hidden="true"
            className="rounded-[3px] border border-border bg-surface px-1.5 font-mono text-[0.6875rem] leading-4 text-muted"
          >
            Ctrl K
          </kbd>
        </button>

        <div className="flex shrink-0 items-center gap-4">
          <div className="hidden min-w-0 flex-col items-end leading-tight lg:flex">
            <span className="text-[0.6875rem] font-semibold tracking-wider text-subtle uppercase">
              Practice
            </span>
            <span className="max-w-36 truncate text-body font-medium text-text xl:max-w-56">
              {user?.tenantName ?? "Style guide"}
            </span>
          </div>
          {user?.demo && (
            <Badge tone="info">
              Demo practice<span className="max-xl:hidden"> · shared with other visitors</span>
            </Badge>
          )}
          {user && <UserMenu user={user} />}
        </div>
      </div>

      <div data-chrome="dark" className="flex h-11 items-stretch bg-navy pr-4 text-sidebar-fg">
        <button
          type="button"
          onClick={() => setLauncherOpen(true)}
          aria-label="App launcher"
          aria-haspopup="dialog"
          className="flex w-14 shrink-0 items-center justify-center border-r border-sidebar-border text-sidebar-fg transition-colors duration-100 hover:bg-sidebar-active hover:text-white"
        >
          <Grip aria-hidden="true" className="size-5" strokeWidth={2} />
        </button>
        <div className="flex shrink-0 items-center gap-2.5 border-r border-sidebar-border px-4">
          <AppIcon app={app} size="sm" />
          <span className="text-body font-semibold text-white">{app.label}</span>
        </div>
        <nav aria-label="Primary" className="flex min-w-0 flex-1 overflow-x-auto">
          <ul className="flex items-stretch">
            {tabs.map((item) => {
              const Icon = item.icon;
              const active = current?.href === item.href;
              return (
                <li key={item.href} className="flex">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2 px-4 text-body font-medium whitespace-nowrap transition-colors duration-100 focus-visible:-outline-offset-2",
                      active
                        ? "bg-sidebar-active text-white shadow-[inset_0_-3px_0_var(--dd-sidebar-accent)]"
                        : "text-sidebar-fg hover:bg-sidebar-active/60 hover:text-white",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      <AppLauncher apps={apps} open={launcherOpen} onClose={() => setLauncherOpen(false)} />
    </header>
  );
}
