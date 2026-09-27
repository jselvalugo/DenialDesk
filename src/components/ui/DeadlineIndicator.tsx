"use client";

import { useFormat, useT } from "@/i18n/client";
import { deadlineTone } from "@/lib/deadline";
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
  const t = useT("common");
  const f = useFormat();
  const tone = deadlineTone(daysRemaining, dueSoonDays);
  const remaining =
    daysRemaining < 0
      ? t("deadline.overdue", { count: Math.abs(daysRemaining) })
      : daysRemaining === 0
        ? t("deadline.dueToday")
        : t("deadline.left", { count: daysRemaining });
  return (
    <span className="inline-flex flex-col leading-tight whitespace-nowrap">
      <span className="tabular text-text">{f.date(dueDate)}</span>
      <span className={cn("tabular text-label", toneText[tone], tone !== "neutral" && "font-medium")}>
        {remaining}
      </span>
    </span>
  );
}
