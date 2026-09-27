import { addCalendarDays, daysBetween, isValidIsoDate, todayIn } from "@rules/calendar";
import { z } from "zod";
import type { MessageKey } from "@/i18n/messages/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = z.uuid();
const MAX_RANGE_DAYS = 366 * 3; // 3 years, generous for a leap year in the middle.

export interface ParsedFilters {
  dateFrom: string;
  dateTo: string;
  payerId: string | null;
  /**
   * A message key (insight namespace), never English text — this is pure domain code and never
   * imports `@/i18n/server`. The caller translates it with `t(filters.error)`.
   */
  error: MessageKey<"insight"> | null;
}

/** Default range: the last 90 days, ending today (Eastern — legal-clock time zone, rules/calendar.ts). */
export function defaultDateRange(today = todayIn()): { dateFrom: string; dateTo: string } {
  return { dateFrom: addCalendarDays(today, -90), dateTo: today };
}

function isRealDate(value: string | null | undefined): value is string {
  return !!value && ISO_DATE.test(value) && isValidIsoDate(value);
}

/**
 * Parses non-PHI query params (report id, ISO date range, payer UUID — R-7.4.8). A malformed or
 * non-existent date (e.g. "2026-02-31"), an end date before the start date, and a range over 3
 * years are all validation errors, surfaced to the person, never a query error or a silent
 * fallback to the default range.
 */
export function parseFilters(input: {
  dateFrom?: string | null;
  dateTo?: string | null;
  payerId?: string | null;
}): ParsedFilters {
  const defaults = defaultDateRange();
  const payerParse = input.payerId ? UUID.safeParse(input.payerId) : undefined;
  const payerId = payerParse?.success ? payerParse.data : null;

  if (input.dateFrom != null && input.dateFrom !== "" && !isRealDate(input.dateFrom)) {
    return {
      dateFrom: defaults.dateFrom,
      dateTo: defaults.dateTo,
      payerId,
      error: "filters.error.invalidStartDate",
    };
  }
  if (input.dateTo != null && input.dateTo !== "" && !isRealDate(input.dateTo)) {
    return {
      dateFrom: defaults.dateFrom,
      dateTo: defaults.dateTo,
      payerId,
      error: "filters.error.invalidEndDate",
    };
  }

  const dateFrom = isRealDate(input.dateFrom) ? input.dateFrom : defaults.dateFrom;
  const dateTo = isRealDate(input.dateTo) ? input.dateTo : defaults.dateTo;

  if (dateTo < dateFrom) {
    return { dateFrom, dateTo, payerId, error: "filters.error.endBeforeStart" };
  }
  if (daysBetween(dateFrom, dateTo) > MAX_RANGE_DAYS) {
    return { dateFrom, dateTo, payerId, error: "filters.error.rangeTooLong" };
  }
  return { dateFrom, dateTo, payerId, error: null };
}
