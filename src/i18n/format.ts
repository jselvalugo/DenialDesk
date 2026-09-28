import { formatCents, formatDate, formatDateOf, formatDateTime } from "@/lib/format";
import { INTL_TAGS, type Locale } from "./config";
import { formatNumber } from "./translate";

export interface Formatters {
  locale: Locale;
  /** Calendar date (YYYY-MM-DD in, no time zone shift) in the locale's order and separators. */
  date: (isoDate: string) => string;
  /** Timestamp in Eastern time with its zone name, in the locale's conventions. */
  dateTime: (at: Date) => string;
  /** The calendar day of a timestamp in Eastern time, date only (e.g. a "Created" column). */
  dateOf: (at: Date) => string;
  /** Counts and plain numbers with the locale's grouping. */
  number: (value: number) => string;
  /** A number with a fixed number of decimals in the locale's digits (12.5 / 12,5). */
  decimal: (value: number, digits: number) => string;
  /** Money: always USD in U.S. form ($1,234.56), whatever the language (ADR 0009). */
  cents: (cents: number) => string;
  /**
   * How long ago (or until) `at` is from `now`, in whole minutes, hours, or days ("5 minutes ago").
   * Secondary text only, beside an absolute time (DESIGN.md §10). `now` is passed in so the server
   * and the browser render the same text.
   */
  relative: (at: Date, now: Date) => string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function formatRelative(at: Date, now: Date, locale: Locale): string {
  const rtf = new Intl.RelativeTimeFormat(INTL_TAGS[locale], { numeric: "auto" });
  const diff = at.getTime() - now.getTime();
  const size = Math.abs(diff);
  if (size < HOUR) return rtf.format(Math.trunc(diff / MINUTE), "minute");
  if (size < DAY) return rtf.format(Math.trunc(diff / HOUR), "hour");
  return rtf.format(Math.trunc(diff / DAY), "day");
}

export function createFormatters(locale: Locale): Formatters {
  return {
    locale,
    date: (isoDate) => formatDate(isoDate, locale),
    dateTime: (at) => formatDateTime(at, locale),
    dateOf: (at) => formatDateOf(at, locale),
    number: (value) => formatNumber(value, locale),
    decimal: (value, digits) =>
      new Intl.NumberFormat(INTL_TAGS[locale], {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value),
    cents: formatCents,
    relative: (at, now) => formatRelative(at, now, locale),
  };
}
