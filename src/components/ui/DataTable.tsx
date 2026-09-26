import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/** Table primitives styled per DESIGN.md §9. Sorting/pagination arrive with TanStack Table (ADR 0004). */
export function Table({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-table">
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
        "sticky top-0 h-9 border-b border-border bg-surface-muted px-3 text-label font-medium whitespace-nowrap text-muted",
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
        selected ? "bg-brand-50" : "hover:bg-surface-muted",
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
      className={cn("h-11 px-3 align-middle text-text", numeric && "tabular text-right", className)}
      {...props}
    />
  );
}
