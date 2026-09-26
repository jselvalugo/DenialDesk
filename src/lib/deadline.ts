export type DeadlineTone = "danger" | "warning" | "neutral";

/**
 * UI tone for a deadline. `dueSoonDays` is a product display setting, not a legal value;
 * legal deadlines themselves come from the rules engine (rules/).
 */
export function deadlineTone(daysRemaining: number, dueSoonDays: number): DeadlineTone {
  if (!Number.isInteger(daysRemaining) || !Number.isInteger(dueSoonDays) || dueSoonDays < 0) {
    throw new Error("deadlineTone expects whole days and a non-negative window");
  }
  if (daysRemaining < 0) return "danger";
  if (daysRemaining <= dueSoonDays) return "warning";
  return "neutral";
}

export function describeDaysRemaining(daysRemaining: number): string {
  if (daysRemaining < -1) return `${Math.abs(daysRemaining)} days overdue`;
  if (daysRemaining === -1) return "1 day overdue";
  if (daysRemaining === 0) return "Due today";
  if (daysRemaining === 1) return "1 day left";
  return `${daysRemaining} days left`;
}
