// Calendar math on ISO dates (YYYY-MM-DD). Legal clocks run in America/New_York (REQUIREMENTS §11).
// Dates are handled as UTC midnights so adding days never shifts across DST.

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function toUtc(iso: string): Date {
  if (!ISO.test(iso)) throw new Error(`Expected YYYY-MM-DD, got "${iso}"`);
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) {
    throw new Error(`Invalid calendar date "${iso}"`);
  }
  return date;
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's date in the given IANA time zone (default Eastern). */
export function todayIn(timeZone = "America/New_York", now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addCalendarDays(iso: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error("days must be an integer");
  return toIso(new Date(toUtc(iso).getTime() + days * DAY_MS));
}

/** Adds calendar months; clamps to the last day of the target month (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(iso: string, months: number): string {
  if (!Number.isInteger(months)) throw new Error("months must be an integer");
  const date = toUtc(iso);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return toIso(target);
}

/** True for a real calendar date in YYYY-MM-DD form (rejects e.g. "2026-02-31"). */
export function isValidIsoDate(iso: string): boolean {
  try {
    toUtc(iso);
    return true;
  } catch {
    return false;
  }
}

/**
 * The UTC instant of `hour:00` local time in `timeZone` on `iso`'s date. One correction pass
 * (naive UTC guess, then shift by that guess's offset) is exact except within the single hour of
 * a DST transition, an acceptable tradeoff for a report date-range boundary (not a legal clock).
 */
function zonedInstant(iso: string, hour: number, timeZone: string): Date {
  const naive = new Date(`${iso}T${String(hour).padStart(2, "0")}:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(naive)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  const localAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = localAsUtc - naive.getTime();
  return new Date(naive.getTime() - offsetMs);
}

/**
 * The UTC instants bounding a calendar day in `timeZone` (default Eastern — legal-clock time
 * zone, REQUIREMENTS §11): `start` is that day's midnight, `endExclusive` is the next day's
 * midnight. Lets a timestamp column be range-filtered by Eastern calendar date without wrapping
 * the column in a function (sargable — the column stays index-scannable).
 */
export function easternDayBoundsUtc(
  iso: string,
  timeZone = "America/New_York",
): { start: Date; endExclusive: Date } {
  return {
    start: zonedInstant(iso, 0, timeZone),
    endExclusive: zonedInstant(addCalendarDays(iso, 1), 0, timeZone),
  };
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS);
}

function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return toIso(new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7)));
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return toIso(new Date(Date.UTC(year, month + 1, -offset)));
}

function observed(iso: string): string {
  const day = toUtc(iso).getUTCDay();
  if (day === 6) return addCalendarDays(iso, -1);
  if (day === 0) return addCalendarDays(iso, 1);
  return iso;
}

/**
 * U.S. federal holidays (5 U.S.C. § 6103), with Saturday → Friday and Sunday → Monday observance.
 * ⚠️ VERIFY which holiday calendar Florida prompt-pay "business day" uses before relying on it.
 */
export function federalHolidays(year: number): string[] {
  const pad = (m: number, d: number) => `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return [
    observed(pad(1, 1)),
    nthWeekday(year, 0, 1, 3), // Birthday of Martin Luther King, Jr.
    nthWeekday(year, 1, 1, 3), // Washington's Birthday
    lastWeekday(year, 4, 1), // Memorial Day
    observed(pad(6, 19)), // Juneteenth
    observed(pad(7, 4)),
    nthWeekday(year, 8, 1, 1), // Labor Day
    nthWeekday(year, 9, 1, 2), // Columbus Day
    observed(pad(11, 11)), // Veterans Day
    nthWeekday(year, 10, 4, 4), // Thanksgiving Day
    observed(pad(12, 25)),
  ];
}

export function isBusinessDay(iso: string, holidays: (year: number) => string[] = federalHolidays): boolean {
  const date = toUtc(iso);
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return false;
  const year = date.getUTCFullYear();
  // New Year's Day can be observed on Dec 31 of the prior year.
  return !holidays(year).includes(iso) && !holidays(year + 1).includes(iso);
}
