import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { cn } from "@/lib/cn";

type ToolbarProps<T extends ElementType> = {
  /** Render as a `form` when the toolbar is the search/filter form itself (keeps its landmark role). */
  as?: T;
  summary?: ReactNode;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children">;

/**
 * The strip above a table inside a flush `Panel`: search and filters on the left, the result count
 * or secondary actions on the right (DESIGN.md §8 "filters toolbar").
 */
export function TableToolbar<T extends ElementType = "div">({
  as,
  summary,
  children,
  className,
  ...props
}: ToolbarProps<T>) {
  const Component: ElementType = as ?? "div";
  return (
    <Component
      className={cn(
        "flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3",
        className,
      )}
      {...props}
    >
      <div className="flex flex-wrap items-end gap-2">{children}</div>
      {summary && <div className="text-label text-muted tabular">{summary}</div>}
    </Component>
  );
}
