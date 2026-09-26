import { formatCents } from "@/lib/format";
import { cn } from "@/lib/cn";

export function Money({ cents, className }: { cents: number; className?: string }) {
  return <span className={cn("tabular whitespace-nowrap", className)}>{formatCents(cents)}</span>;
}
