const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usDate = new Intl.DateTimeFormat("en-US", {
  month: "2-digit",
  day: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

/** Money is stored as integer cents (never floats). Formats as $1,234.56 / -$1,234.56. */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new Error("formatCents expects an integer number of cents");
  }
  // Avoid "-$0.00": -0 cents (e.g. a month with zero net adjustments, negated for display) is zero.
  return usd.format(cents === 0 ? 0 : cents / 100);
}

/** Formats a calendar date (YYYY-MM-DD, no time zone shift) as MM/DD/YYYY. */
export function formatDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error("formatDate expects YYYY-MM-DD");
  }
  return usDate.format(new Date(`${isoDate}T00:00:00Z`));
}

const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  month: "2-digit",
  day: "2-digit",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/New_York",
  timeZoneName: "short",
});

/** Timestamp for history panels: `10/14/2026, 5:00 PM EDT` (DESIGN.md §10). */
export function formatDateTime(at: Date): string {
  return dateTimeFormat.format(at);
}
