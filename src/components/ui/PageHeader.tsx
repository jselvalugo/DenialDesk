import type { ReactNode } from "react";
import { PageEyebrow, PageIcon } from "@/components/shell/PageContext";

/** Page header band (DESIGN.md §8): module tile, "Module · Page" eyebrow, serif title, actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-panel border border-border bg-surface px-5 py-4 shadow-xs">
      <div className="flex min-w-0 items-center gap-4">
        <PageIcon />
        <div className="min-w-0">
          <PageEyebrow title={title} />
          <h1 className="font-serif text-display font-bold text-primary">{title}</h1>
          {description && <p className="mt-0.5 max-w-3xl text-body text-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
