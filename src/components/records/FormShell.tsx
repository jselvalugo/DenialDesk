import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Sectioned edit form (docs/specs/record-pages.md). Each `FormSection` puts its title and a short
 * explanation in a narrow left column and the fields on the right, so a long form reads as a few
 * named groups instead of one wall of inputs. `FormActions` is the footer bar with the one primary
 * button and a Cancel link. Use inside `<Panel flush>`.
 */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  // A `<legend>` must be a fieldset's first child, which a two-column grid can't give it, so the
  // group is named through `aria-labelledby` instead (WCAG 1.3.1).
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  return (
    <section
      role="group"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className="grid gap-4 border-b border-border px-5 py-5 last-of-type:border-b-0 md:grid-cols-[200px_minmax(0,1fr)] md:gap-8"
    >
      <div>
        <h2 id={titleId} className="text-heading font-semibold text-text">
          {title}
        </h2>
        {description && (
          <p id={descriptionId} className="mt-1 text-label text-muted">
            {description}
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

/** A row of fields; `columns` is the Tailwind grid template for md and up. */
export function FormRow({ columns, children }: { columns: string; children: ReactNode }) {
  return <div className={cn("grid gap-4", columns)}>{children}</div>;
}

export function FormActions({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-muted px-5 py-3">
      <div className="flex items-center gap-2">{children}</div>
      {note && <p className="text-label text-muted">{note}</p>}
    </div>
  );
}

/** Notices above the sections (errors, synthetic-only reminder). */
export function FormNotices({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 px-5 pt-5 empty:hidden">{children}</div>;
}
