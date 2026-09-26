import type { ReactNode } from "react";

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
    <header className="flex items-start justify-between gap-6 border-b border-border pb-5">
      <div className="min-w-0">
        <h1 className="font-serif text-display font-bold text-primary">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-body text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
