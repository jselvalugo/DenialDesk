import Link from "next/link";
import { ArrowRight, ChevronRight, type LucideIcon } from "lucide-react";
import type { NavApp } from "@/components/shell/navigation";
import { toneClasses } from "@/components/shell/tones";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

export interface FlowStep {
  id: string;
  icon: LucideIcon;
  /** The tint of the module the step happens in (DESIGN.md §4). */
  tone: NavApp["tone"];
  title: string;
  body: string;
  /** Null until the step ships: shown as "Planned", never a link. */
  href: string | null;
  linkLabel?: string;
}

/**
 * A numbered left-to-right pipeline. Each step carries its module tile; a solid connector joins two
 * shipped steps and a dashed one touches a planned step. A shipped step is one link covering its cell.
 */
export function FlowSteps({
  steps,
  dataAttribute,
  plannedLabel,
}: {
  steps: FlowStep[];
  /** Hook for tests: each item gets `<dataAttribute>="<n>"`. */
  dataAttribute: `data-${string}`;
  plannedLabel: string;
}) {
  return (
    <ol className="grid grid-cols-1 divide-y divide-border md:auto-cols-fr md:grid-flow-col md:divide-x md:divide-y-0">
      {steps.map((step, index) => {
        const next = steps[index + 1];
        return (
          <li
            key={step.id}
            {...{ [dataAttribute]: index + 1 }}
            className={cn(
              "group relative flex flex-col gap-2 px-4 pt-4 pb-4",
              step.href &&
                "transition-colors duration-150 ease-out hover:bg-surface-muted motion-reduce:transition-none",
            )}
          >
            <div className="mb-1 flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "inline-flex size-9 shrink-0 items-center justify-center rounded-control border",
                  toneClasses[step.href ? step.tone : "slate"],
                )}
              >
                <step.icon className="size-4" strokeWidth={1.75} />
              </span>
              <span className="font-mono text-label text-subtle tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              {next && (
                <span aria-hidden="true" className="ml-1 hidden flex-1 items-center md:flex">
                  <span
                    className={cn(
                      "h-0 flex-1 border-t",
                      step.href && next.href ? "border-border-strong" : "border-dashed border-border-strong",
                    )}
                  />
                  <ChevronRight className="-ml-1 size-3.5 text-border-strong" strokeWidth={2} />
                </span>
              )}
            </div>
            <h3 className="text-heading font-semibold text-text">{step.title}</h3>
            <p className="flex-1 text-body text-muted">{step.body}</p>
            {step.href ? (
              <Link
                href={step.href}
                className="inline-flex items-center gap-1 self-start text-body font-medium text-link after:absolute after:inset-0 hover:underline"
              >
                {step.linkLabel}
                <ArrowRight
                  aria-hidden="true"
                  className="size-3.5 transition-transform duration-150 ease-out motion-safe:group-hover:translate-x-0.5"
                  strokeWidth={2}
                />
              </Link>
            ) : (
              <span>
                <Badge dot={false}>{plannedLabel}</Badge>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
