"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { navigation, type NavItem } from "./navigation";

function NavEntry({ item, active }: { item: NavItem; active: boolean }) {
  const base = "flex h-8 items-center justify-between rounded-control px-2.5 text-body";
  if (!item.available) {
    return (
      <span aria-disabled="true" className={cn(base, "cursor-default text-subtle")}>
        {item.label}
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
        active
          ? "bg-brand-50 font-medium text-brand-700 shadow-[inset_2px_0_0_var(--dd-brand-600)]"
          : "text-text hover:bg-surface-muted",
      )}
    >
      {item.label}
    </Link>
  );
}

export function Sidebar({
  showDesignSystem,
  showOperatorConsole = false,
}: {
  showDesignSystem: boolean;
  showOperatorConsole?: boolean;
}) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-14 items-center border-b border-border px-4">
        <Link href="/" aria-label="DenialDesk home">
          <Image src="/brand/denialdesk-logo.png" alt="DenialDesk" width={140} height={33} priority />
        </Link>
      </div>
      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-4">
        {navigation.map((section) => (
          <div key={section.label} className="mb-5">
            <p className="mb-1 px-2.5 text-label font-medium text-subtle">{section.label}</p>
            <ul className="space-y-px">
              {section.items.map((item) => (
                <li key={item.href}>
                  <NavEntry item={item} active={item.available && isActive(item.href)} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      {(showDesignSystem || showOperatorConsole) && (
        <div className="space-y-px border-t border-border px-3 py-3">
          {showOperatorConsole && (
            <NavEntry
              item={{ label: "Platform console", href: "/operator", available: true }}
              active={isActive("/operator")}
            />
          )}
          {showDesignSystem && (
            <NavEntry
              item={{ label: "Design system", href: "/design", available: true }}
              active={isActive("/design")}
            />
          )}
        </div>
      )}
    </aside>
  );
}
