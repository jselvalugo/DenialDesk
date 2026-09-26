import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "danger" | "warning" | "success" | "info" | "neutral";

const tones: Record<Tone, string> = {
  danger: "bg-danger-bg text-danger-fg border-danger-border",
  warning: "bg-warning-bg text-warning-fg border-warning-border",
  success: "bg-success-bg text-success-fg border-success-border",
  info: "bg-info-bg text-info-fg border-info-border",
  neutral: "bg-neutral-bg text-neutral-fg border-neutral-border",
};

const dots: Record<Tone, string> = {
  danger: "bg-danger-fg",
  warning: "bg-warning-fg",
  success: "bg-success-fg",
  info: "bg-info-fg",
  neutral: "bg-neutral-fg",
};

export function Badge({
  tone = "neutral",
  dot = true,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-control border px-1.5 text-label font-medium whitespace-nowrap",
        tones[tone],
      )}
    >
      {dot && <span aria-hidden className={cn("size-1.5 rounded-full", dots[tone])} />}
      {children}
    </span>
  );
}
