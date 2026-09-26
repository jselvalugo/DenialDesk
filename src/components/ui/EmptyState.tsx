import type { ReactNode } from "react";

/** Says what is missing and what to do next. Never "Nothing here!". */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-3 px-6 py-10">
      <div>
        <h3 className="text-heading font-semibold text-text">{title}</h3>
        <p className="mt-1 max-w-xl text-body text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}
