import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  name: string;
  options: Array<{ value: string; label: string }>;
  hint?: string;
  error?: string;
}

/** Form select matching `TextField` (label above, hint and error below). `Select` is the toolbar variant. */
export function SelectField({
  label,
  name,
  options,
  hint,
  error,
  className,
  id,
  ...props
}: SelectFieldProps) {
  const selectId = id ?? `field-${name}`;
  const describedBy =
    [hint && `${selectId}-hint`, error && `${selectId}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={selectId} className="text-label font-medium text-text">
        {label}
      </label>
      <select
        id={selectId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "h-9 rounded-control border bg-surface pr-8 pl-3 text-body text-text",
          "focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus",
          error ? "border-danger-fg" : "border-border-strong",
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
      {hint && (
        <p id={`${selectId}-hint`} className="text-label text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${selectId}-error`} className="text-label font-medium text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}
