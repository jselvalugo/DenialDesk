"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export interface SettingsTab {
  label: string;
  href: string;
  /** False until the section ships: shown as "Planned", never a link. */
  available: boolean;
}

/** Section tabs under the Settings header (docs/specs/settings-and-custom-fields.md). */
export function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const pathname = usePathname();
  const current = tabs
    .filter((tab) => tab.available && (pathname === tab.href || pathname.startsWith(`${tab.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <nav aria-label="Settings sections" className="border-b border-border">
      <ul className="-mb-px flex flex-wrap gap-x-1">
        {tabs.map((tab) => (
          <li key={tab.href}>
            {tab.available ? (
              <Link
                href={tab.href}
                aria-current={tab === current ? "page" : undefined}
                className={cn(
                  "inline-flex h-10 items-center border-b-2 px-3 text-body font-medium",
                  tab === current
                    ? "border-primary text-primary"
                    : "border-transparent text-muted hover:border-border-strong hover:text-text",
                )}
              >
                {tab.label}
              </Link>
            ) : (
              <span
                className="inline-flex h-10 cursor-default items-center gap-1.5 border-b-2 border-transparent px-3 text-body text-subtle"
                title="Planned"
              >
                {tab.label}
                <span className="rounded-control border border-dashed border-border-strong px-1 text-label">
                  Planned
                </span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
