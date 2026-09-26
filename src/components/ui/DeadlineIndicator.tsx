import { deadlineTone, describeDaysRemaining } from "@/lib/deadline";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";

const toneText = {
  danger: "text-danger-fg",
  warning: "text-warning-fg",
  neutral: "text-muted",
} as const;

/** Date plus days remaining, colored by urgency. Always shows text, never color alone. */
export function DeadlineIndicator({
  dueDate,
  daysRemaining,
  dueSoonDays = 7,
}: {
  dueDate: string;
  daysRemaining: number;
  dueSoonDays?: number;
}) {
  const tone = deadlineTone(daysRemaining, dueSoonDays);
  return (
    <span className="inline-flex flex-col leading-tight">
      <span className="tabular text-text">{formatDate(dueDate)}</span>
      <span className={cn("tabular text-label", toneText[tone], tone !== "neutral" && "font-medium")}>
        {describeDaysRemaining(daysRemaining)}
      </span>
    </span>
  );
}
