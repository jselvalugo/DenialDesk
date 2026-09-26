import { todayIn, addCalendarDays } from "@rules/calendar";
import { z } from "zod";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = z.uuid();

export interface ParsedFilters {
  dateFrom: string;
  dateTo: string;
  payerId: string | null;
  error: string | null;
}

/** Default range: the last 90 days, ending today (Eastern — legal-clock time zone, rules/calendar.ts). */
export function defaultDateRange(today = todayIn()): { dateFrom: string; dateTo: string } {
  return { dateFrom: addCalendarDays(today, -90), dateTo: today };
}

/**
 * Parses non-PHI query params (report id, ISO date range, payer UUID — R-7.4.8). An end date
 * before the start date is a validation error, not a query error.
 */
export function parseFilters(input: {
  dateFrom?: string | null;
  dateTo?: string | null;
  payerId?: string | null;
}): ParsedFilters {
  const defaults = defaultDateRange();
  const dateFrom = input.dateFrom && ISO_DATE.test(input.dateFrom) ? input.dateFrom : defaults.dateFrom;
  const dateTo = input.dateTo && ISO_DATE.test(input.dateTo) ? input.dateTo : defaults.dateTo;
  const payerParse = input.payerId ? UUID.safeParse(input.payerId) : undefined;
  const payerId = payerParse?.success ? payerParse.data : null;
  if (dateTo < dateFrom) {
    return { dateFrom, dateTo, payerId, error: "The end date must be on or after the start date." };
  }
  return { dateFrom, dateTo, payerId, error: null };
}
