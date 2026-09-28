import type { CSSProperties, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/** `Table`'s row height/padding: `"compact"` for dense working queues; omitted keeps today's sizing. */
export type Density = "default" | "compact";
/** A column's current sort direction, and the `dir` query value a sortable header link sets. */
export type SortDir = "asc" | "desc";

// A CSS custom property inherited from `<table>` down to every `Td`, so density needs no React
// context (this module stays server-renderable, ADR 0001 "Server Components by default"). Absent
// (the default table), `Td` falls back to its original `h-11 px-3` sizing exactly.
const compactRowStyle = { "--dd-row-h": "2rem", "--dd-row-px": "0.5rem" } as unknown as CSSProperties;

/** Table primitives styled per DESIGN.md §9. Sortable headers: `SortableHeader` below. */
export function Table({
  caption,
  density = "default",
  children,
}: {
  caption: string;
  /** Compact rows (DESIGN.md §9: "40px rows (32px compact)"); omit to keep default rendering. */
  density?: Density;
  children: ReactNode;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full border-collapse text-table"
        style={density === "compact" ? compactRowStyle : undefined}
      >
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th({
  numeric,
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "sticky top-0 h-9 border-b border-border bg-surface-muted px-3 text-label font-semibold tracking-wider whitespace-nowrap text-muted uppercase",
        numeric ? "text-right" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

export function Tr({ selected, children }: { selected?: boolean; children: ReactNode }) {
  return (
    <tr
      aria-selected={selected || undefined}
      className={cn(
        "border-b border-border last:border-b-0",
        selected ? "bg-selected" : "hover:bg-surface-muted",
      )}
    >
      {children}
    </tr>
  );
}

export function Td({
  numeric,
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "h-[var(--dd-row-h,2.75rem)] px-[var(--dd-row-px,0.75rem)] align-middle text-text",
        numeric && "tabular text-right",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Given whether this column is already the active sort and its current direction, returns the
 * direction a click on its header sets next: toggled if already active, otherwise the column's own
 * first-click direction (`defaultDir`, e.g. money columns start descending, names start ascending).
 */
export function nextSortDir(active: boolean, dir: SortDir, defaultDir: SortDir): SortDir {
  if (!active) return defaultDir;
  return dir === "asc" ? "desc" : "asc";
}

/**
 * A `Th` whose content is a plain link that sets `?sort=<key>&dir=asc|desc` (server-side sorting;
 * ADR 0004 addendum — TanStack stays deferred until a list needs client-side interactivity). Real
 * navigation (`<a href>`), so it needs no JavaScript. `aria-sort` goes on the `th` itself (DESIGN.md
 * §11) and a visible arrow marks the direction (`aria-hidden`, decorative next to the text). The
 * link's accessible name is the visible column label (`label`) followed by `hint`, a short
 * visually-hidden phrase naming the direction the click applies — never an `aria-label` that would
 * replace the column name, so the header still reads as "Denied" (plus the hint), not something
 * else entirely. A screen reader gets the *current* sorted state from `aria-sort`; `hint` says what
 * activating the link does next.
 */
export function SortableHeader({
  label,
  href,
  active,
  dir,
  hint,
  numeric,
}: {
  label: ReactNode;
  href: string;
  active: boolean;
  dir: SortDir;
  hint: string;
  numeric?: boolean;
}) {
  return (
    <Th numeric={numeric} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={href} className="inline-flex items-center gap-1 hover:text-text">
        <span>{label}</span>
        {active ? (
          dir === "asc" ? (
            <ArrowUp aria-hidden="true" className="size-3.5 shrink-0" />
          ) : (
            <ArrowDown aria-hidden="true" className="size-3.5 shrink-0" />
          )
        ) : (
          <ArrowUpDown aria-hidden="true" className="size-3.5 shrink-0 opacity-50" />
        )}
        <span className="sr-only"> {hint}</span>
      </Link>
    </Th>
  );
}
