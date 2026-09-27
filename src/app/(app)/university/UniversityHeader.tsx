import type { ReactNode } from "react";
import { GraduationCap } from "lucide-react";
import { toneClasses } from "@/components/shell/tones";
import { cn } from "@/lib/cn";

/**
 * Page header for University pages (DESIGN.md §8 page header band). The University is not a
 * module, so it carries its own tile and eyebrow instead of the shell's current-module ones.
 */
export function UniversityHeader({
  eyebrow = "DenialDesk University",
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-panel border border-border bg-surface px-5 py-4 shadow-xs">
      <div className="flex min-w-0 items-center gap-4">
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex size-10 shrink-0 items-center justify-center rounded-control border",
            toneClasses.teal,
          )}
        >
          <GraduationCap className="size-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className="text-label font-semibold tracking-wider text-muted uppercase">{eyebrow}</p>
          <h1 className="font-serif text-display font-bold text-primary">{title}</h1>
          {description && <p className="mt-0.5 max-w-3xl text-body text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
