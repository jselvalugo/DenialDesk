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
  return usd.format(cents / 100);
}

/** Formats a calendar date (YYYY-MM-DD, no time zone shift) as MM/DD/YYYY. */
export function formatDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error("formatDate expects YYYY-MM-DD");
  }
  return usDate.format(new Date(`${isoDate}T00:00:00Z`));
}
