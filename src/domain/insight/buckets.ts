import { daysUntil } from "@rules/deadlines";
import type { Messages, MessageKey } from "@/i18n/messages/types";
import type { Translator } from "@/i18n/translate";

export type DeadlineBucket = "past_deadline" | "0-7" | "8-30" | "31-plus" | "no_deadline";

/** Message key (insight namespace) for each bucket's label; show it with `t(DEADLINE_BUCKET_LABEL_KEYS[b])`. */
export const DEADLINE_BUCKET_LABEL_KEYS: Record<DeadlineBucket, MessageKey<"insight">> = {
  past_deadline: "bucket.pastDeadline",
  "0-7": "bucket.0to7",
  "8-30": "bucket.8to30",
  "31-plus": "bucket.31plus",
  no_deadline: "bucket.noDeadline",
};

/** The bucket's name in the user's language: `deadlineBucketLabel(bucket, t)` with `t` from the insight namespace. */
export function deadlineBucketLabel(bucket: DeadlineBucket, t: Translator<Messages["insight"]>): string {
  return t(DEADLINE_BUCKET_LABEL_KEYS[bucket]);
}

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
