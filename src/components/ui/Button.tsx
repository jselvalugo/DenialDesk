import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white border-brand-600 hover:bg-brand-700 hover:border-brand-700",
  secondary: "bg-surface text-text border-border-strong hover:bg-surface-muted",
  ghost: "bg-transparent text-text border-transparent hover:bg-surface-muted",
  danger: "bg-surface text-danger-fg border-danger-border hover:bg-danger-bg",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-label",
  md: "h-8 px-3 text-body",
};

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-control border font-medium whitespace-nowrap",
        "transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
