import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A single real metric. Never used for invented or placeholder numbers (DESIGN.md §3). */
export function StatTile({
  label,
  value,
  detail,
  emphasis,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  emphasis?: "danger" | "warning";
}) {
  return (
    <div className="rounded-panel border border-border bg-surface px-4 py-3.5">
      <p className="text-label font-medium text-muted">{label}</p>
      <p
        className={cn(
          "tabular mt-1 text-display font-semibold",
          emphasis === "danger" ? "text-danger-fg" : emphasis === "warning" ? "text-warning-fg" : "text-text",
        )}
      >
        {value}
      </p>
      {detail && <p className="mt-0.5 text-label text-muted">{detail}</p>}
    </div>
  );
}
