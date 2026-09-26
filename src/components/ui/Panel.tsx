import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Panel({
  title,
  description,
  actions,
  flush = false,
  children,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  /** Remove body padding, e.g. for tables that run edge to edge. */
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rounded-panel border border-border bg-surface">
      {title && (
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-heading font-semibold text-primary">{title}</h2>
            {description && <p className="text-label font-normal text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={cn(!flush && "p-4")}>{children}</div>
    </section>
  );
}
