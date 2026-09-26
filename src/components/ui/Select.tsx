import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  /** Visually hide the label (still announced) for compact toolbars. */
  hideLabel?: boolean;
}

/** Native select: accessible and keyboard-friendly by default; styled to our tokens. */
export function Select({ label, name, options, hideLabel, className, id, ...props }: SelectProps) {
  const selectId = id ?? `select-${name}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={selectId} className={cn("text-label font-medium text-muted", hideLabel && "sr-only")}>
        {label}
      </label>
      <select
        id={selectId}
        name={name}
        className={cn(
          "h-8 rounded-control border border-border-strong bg-surface pr-8 pl-2.5 text-body text-text",
          "focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus",
          className,
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
