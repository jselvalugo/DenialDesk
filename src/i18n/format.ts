import { formatCents, formatDate, formatDateTime } from "@/lib/format";
import type { Locale } from "./config";
import { formatNumber } from "./translate";

export interface Formatters {
  locale: Locale;
  /** Calendar date (YYYY-MM-DD in, no time zone shift) in the locale's order and separators. */
  date: (isoDate: string) => string;
  /** Timestamp in Eastern time with its zone name, in the locale's conventions. */
  dateTime: (at: Date) => string;
  /** Counts and plain numbers with the locale's grouping. */
  number: (value: number) => string;
  /** Money: always USD in U.S. form ($1,234.56), whatever the language (ADR 0009). */
  cents: (cents: number) => string;
}

export function createFormatters(locale: Locale): Formatters {
  return {
    locale,
    date: (isoDate) => formatDate(isoDate, locale),
    dateTime: (at) => formatDateTime(at, locale),
    number: (value) => formatNumber(value, locale),
    cents: formatCents,
  };
}
