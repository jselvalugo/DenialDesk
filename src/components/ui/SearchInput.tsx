import { Search } from "lucide-react";
import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  name: string;
  /** Show the label above the field instead of only to screen readers. */
  showLabel?: boolean;
  /** How to search (minimum length, formats); announced with the field, visible on request. */
  hint?: string;
  showHint?: boolean;
}

/** A search field with a leading glyph, for table toolbars. Terms are POSTed by the owning form. */
export function SearchInput({
  label,
  name,
  showLabel = false,
  hint,
  showHint = false,
  className,
  id,
  ...props
}: SearchInputProps) {
  const inputId = id ?? `search-${name}`;
  const hintId = `${inputId}-hint`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className={cn("text-label font-medium text-muted", !showLabel && "sr-only")}>
        {label}
      </label>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle"
          strokeWidth={1.75}
        />
        <input
          id={inputId}
          name={name}
          type="search"
          autoComplete="off"
          aria-describedby={hint ? hintId : undefined}
          className={cn(
            "h-8 rounded-control border border-border-strong bg-surface pr-2.5 pl-8 text-body text-text placeholder:text-subtle",
            "focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus",
            className,
          )}
          {...props}
        />
      </div>
      {hint && (
        <p id={hintId} className={cn("text-label text-muted", !showHint && "sr-only")}>
          {hint}
        </p>
      )}
    </div>
  );
}
