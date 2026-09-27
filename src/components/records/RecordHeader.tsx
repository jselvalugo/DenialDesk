import type { ReactNode } from "react";
import { PageEyebrow, PageIcon } from "@/components/shell/PageContext";
import { cn } from "@/lib/cn";

export interface RecordMetaItem {
  label: string;
  value: ReactNode;
  /** Identifiers in mono; dates and counts tabular. */
  mono?: boolean;
  tabular?: boolean;
}

/**
 * Header band for one record (a patient, claim, denial, appeal): the module tile and eyebrow, the
 * record's title with its status or tag badges, a row of labelled facts, and the record's actions on
 * the right. The page `h1` is the record's own name or number, never a generic "Detail" word.
 * Pair with `Breadcrumbs` above and `RecordLayout` below (docs/specs/record-pages.md).
 */
export function RecordHeader({
  title,
  eyebrow,
  titleStyle = "serif",
  badges,
  meta,
  actions,
  children,
}: {
  title: ReactNode;
  /** The page part of the "Module · Page" eyebrow, e.g. "Patient record". */
  eyebrow: string;
  /** Serif for names; mono for identifiers such as claim numbers. */
  titleStyle?: "serif" | "mono";
  badges?: ReactNode;
  meta?: RecordMetaItem[];
  actions?: ReactNode;
  /** Extra content under the meta row (notes, warnings). */
  children?: ReactNode;
}) {
  return (
    <header className="rounded-panel border border-border bg-surface shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 py-4">
        <div className="flex min-w-0 items-start gap-4">
          <PageIcon />
          <div className="min-w-0">
            <PageEyebrow page={eyebrow} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1
                className={cn(
                  "font-bold text-primary",
                  titleStyle === "mono" ? "font-mono text-[1.5rem] leading-8" : "font-serif text-display",
                )}
              >
                {title}
              </h1>
              {badges && <div className="flex flex-wrap items-center gap-1.5">{badges}</div>}
            </div>
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {meta && meta.length > 0 && (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 border-t border-border bg-surface-muted/60 px-5 py-2.5">
          {meta.map((item, index) => (
            <div key={index} className="flex items-baseline gap-2">
              <dt className="text-label font-semibold tracking-wider text-muted uppercase">{item.label}</dt>
              <dd className={cn("text-table text-text", item.mono && "font-mono", item.tabular && "tabular")}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </header>
  );
}
