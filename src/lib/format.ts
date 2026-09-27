import { INTL_TAGS, type Locale } from "@/i18n/config";

// Money is USD in U.S. form in every language (ADR 0009): amounts match payer paperwork and the
// dollars-and-cents entry format, and a Brazilian-style "1.234,56" beside "1,234.56" invites misreads.
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const dateFormats = new Map<Locale, Intl.DateTimeFormat>();
function dateFormat(locale: Locale): Intl.DateTimeFormat {
  let format = dateFormats.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(INTL_TAGS[locale], {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    });
    dateFormats.set(locale, format);
  }
  return format;
}

/** Money is stored as integer cents (never floats). Formats as $1,234.56 / -$1,234.56. */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new Error("formatCents expects an integer number of cents");
  }
  // Avoid "-$0.00": -0 cents (e.g. a month with zero net adjustments, negated for display) is zero.
  return usd.format(cents === 0 ? 0 : cents / 100);
}

/**
 * A plain dollar amount ("0.29", "125", "1250.00") to integer cents. Returns null for anything
 * else — blank, negative, a thousands separator, a currency sign, or more than two decimal places
 * (e.g. "1.005") — so a caller never silently rounds a mistyped amount.
 */
export function parseDollarsToCents(text: string): number | null {
  const cleaned = text.trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/**
 * Formats a calendar date (YYYY-MM-DD, no time zone shift) in the language's order: MM/DD/YYYY in
 * English, DD/MM/YYYY in Spanish and Portuguese. Pages get the language from getFormat()/useFormat().
 */
export function formatDate(isoDate: string, locale: Locale = "en"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error("formatDate expects YYYY-MM-DD");
  }
  return dateFormat(locale).format(new Date(`${isoDate}T00:00:00Z`));
}

const dateTimeFormats = new Map<Locale, Intl.DateTimeFormat>();
function dateTimeFormat(locale: Locale): Intl.DateTimeFormat {
  let format = dateTimeFormats.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(INTL_TAGS[locale], {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
      timeZoneName: "short",
    });
    dateTimeFormats.set(locale, format);
  }
  return format;
}

/** Timestamp for history panels: `10/14/2026, 5:00 PM EDT` (DESIGN.md §10), in the language's form. */
export function formatDateTime(at: Date, locale: Locale = "en"): string {
  return dateTimeFormat(locale).format(at);
}

const dateOfFormats = new Map<Locale, Intl.DateTimeFormat>();
/** The calendar day of an instant in Eastern time, in the language's date order (no time of day). */
export function formatDateOf(at: Date, locale: Locale = "en"): string {
  let format = dateOfFormats.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(INTL_TAGS[locale], {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
      timeZone: "America/New_York",
    });
    dateOfFormats.set(locale, format);
  }
  return format.format(at);
}
