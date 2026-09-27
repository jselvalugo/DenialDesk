import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  name: string;
  hint?: string;
  error?: string;
}

/** Multi-line text matching `TextField`: label above, hint and error announced with the field. */
export function TextareaField({
  label,
  name,
  hint,
  error,
  className,
  id,
  rows = 2,
  ...props
}: TextareaFieldProps) {
  const inputId = id ?? `field-${name}`;
  const describedBy =
    [hint && `${inputId}-hint`, error && `${inputId}-error`].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-label font-medium text-text">
        {label}
      </label>
      <textarea
        id={inputId}
        name={name}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "rounded-control border bg-surface px-3 py-2 text-body text-text placeholder:text-subtle",
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
