import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface Crumb {
  label: ReactNode;
  /** Omit on the current page (rendered as plain text, `aria-current="page"`). */
  href?: string;
  /** Identifiers (MRN, claim number) in mono. */
  mono?: boolean;
}

/** Breadcrumb trail above a record or form page: list → record → action (DESIGN.md §8). */
export function Breadcrumbs({ label, items }: { label: string; items: Crumb[] }) {
  return (
    <nav aria-label={label} className="text-label text-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={index} className="flex items-center gap-1.5">
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className={cn("font-medium text-link hover:underline", item.mono && "font-mono")}
                >
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={cn(item.mono && "font-mono")}>
                  {item.label}
                </span>
              )}
              {!last && <span aria-hidden>/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
