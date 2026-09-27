import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Label-over-value facts inside a panel (demographics, coverage, record metadata). One or two
 * columns; every value is left-aligned so the eye scans down one edge. Use `Field` for each entry.
 */
export function FieldList({ columns = 1, children }: { columns?: 1 | 2; children: ReactNode }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-4", columns === 2 ? "grid-cols-2" : "grid-cols-1")}>{children}</dl>
  );
}

export function Field({
  label,
  children,
  empty,
  mono,
  tabular,
  span,
}: {
  label: string;
  children?: ReactNode;
  /**
   * Text shown muted when there is no value ("Not on file"). Never an English literal here. Only
   * null, undefined, false, and "" count as empty: pass null (not [] or an empty fragment) for a
   * missing value, and 0 is a real value.
   */
  empty?: string;
  mono?: boolean;
  tabular?: boolean;
  /** Take the full row in a two-column list. */
  span?: boolean;
}) {
  const hasValue = children !== null && children !== undefined && children !== "" && children !== false;
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", span && "col-span-full")}>
      <dt className="text-label font-medium text-muted">{label}</dt>
      <dd className={cn("text-body break-words text-text", mono && "font-mono", tabular && "tabular")}>
        {hasValue ? children : <span className="text-subtle">{empty}</span>}
      </dd>
    </div>
  );
}
