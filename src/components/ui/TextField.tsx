import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  hint?: string;
  error?: string;
}

/** Label above the field, hint below, error announced with the field (DESIGN.md §8, §11). */
export function TextField({ label, name, hint, error, className, id, ...props }: TextFieldProps) {
  const inputId = id ?? `field-${name}`;
  const describedBy =
    [hint && `${inputId}-hint`, error && `${inputId}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-label font-medium text-text">
        {label}
      </label>
      <input
        id={inputId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "h-9 rounded-control border bg-surface px-3 text-body text-text placeholder:text-subtle",
          "focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus",
          error ? "border-danger-fg" : "border-border-strong",
          className,
        )}
        {...props}
      />
      {hint && (
        <p id={`${inputId}-hint`} className="text-label text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${inputId}-error`} className="text-label font-medium text-danger-fg">
          {error}
        </p>
      )}
    </div>
  );
}
