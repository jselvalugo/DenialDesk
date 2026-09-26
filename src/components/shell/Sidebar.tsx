"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Palette } from "lucide-react";
import { cn } from "@/lib/cn";
import { navigation, type NavItem } from "./navigation";

function NavEntry({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  const base = "flex h-9 items-center gap-2.5 rounded-control px-3 text-body";
  const icon = <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />;
  if (!item.available) {
    return (
      <span aria-disabled="true" className={cn(base, "cursor-default text-sidebar-muted")}>
        {icon}
        <span className="flex-1">{item.label}</span>
        <span className="text-label font-normal">Planned</span>
      </span>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        base,
        "font-medium",
        active
          ? "bg-sidebar-active text-white shadow-[inset_3px_0_0_var(--dd-sidebar-accent)]"
          : "text-sidebar-fg hover:bg-sidebar-active/60 hover:text-white",
      )}
    >
      {icon}
      {item.label}
    </Link>
  );
}

export function Sidebar({
  showDesignSystem,
  showRevenueCycle = false,
}: {
  showDesignSystem: boolean;
  showRevenueCycle?: boolean;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside data-chrome="dark" className="flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-fg">
      {/* The logo sits on white so its colors stay exactly as designed. */}
      <div className="flex h-14 items-center border-r border-b border-border bg-surface px-5">
        <Link href="/" aria-label="DenialDesk home">
          <Image src="/brand/denialdesk-logo.png" alt="DenialDesk" width={148} height={35} priority />
        </Link>
      </div>
      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-5">
        {navigation
          .filter((section) => showRevenueCycle || !section.revenueCycle)
          .map((section) => (
            <div key={section.label} className="mb-6">
              <p className="mb-1.5 px-3 text-label font-semibold tracking-wider text-sidebar-muted uppercase">
                {section.label}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <NavEntry item={item} active={item.available && isActive(item.href)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </nav>
      {showDesignSystem && (
        <div className="space-y-0.5 border-t border-sidebar-border px-3 py-3">
          <NavEntry
            item={{ label: "Design system", href: "/design", icon: Palette, available: true }}
            active={isActive("/design")}
          />
        </div>
      )}
    </aside>
  );
}
