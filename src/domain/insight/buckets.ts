import { daysUntil } from "@rules/deadlines";

export type DeadlineBucket = "past_deadline" | "0-7" | "8-30" | "31-plus" | "no_deadline";

export const DEADLINE_BUCKET_LABELS: Record<DeadlineBucket, string> = {
  past_deadline: "Past deadline",
  "0-7": "0–7 days",
  "8-30": "8–30 days",
  "31-plus": "31+ days",
  no_deadline: "No deadline configured",
};

/** Fixed display order for report #4 (docs/specs/insight-standard-reports.md #4). */
export const DEADLINE_BUCKET_ORDER: DeadlineBucket[] = [
  "past_deadline",
  "0-7",
  "8-30",
  "31-plus",
  "no_deadline",
];

/**
 * Buckets a denial's appeal deadline the same way the queue does (never re-derived legal math —
 * only `daysUntil`, shared with `rules/deadlines.ts`, is used here). `appealDeadline === null`
 * (unverified payer or no contract window) is its own bucket, never guessed into another one.
 */
export function deadlineBucket(appealDeadline: string | null, today: string): DeadlineBucket {
  if (appealDeadline === null) return "no_deadline";
  const days = daysUntil(appealDeadline, today);
  if (days < 0) return "past_deadline";
  if (days <= 7) return "0-7";
  if (days <= 30) return "8-30";
  return "31-plus";
}
