import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  addMonths,
  daysBetween,
  easternDayBoundsUtc,
  federalHolidays,
  floridaHolidays,
  holidayCalendars,
  isBusinessDay,
  isValidIsoDate,
  rollForwardToBusinessDay,
  todayIn,
} from "./calendar";

describe("calendar", () => {
  it("adds days across month, year, and DST boundaries", () => {
    expect(addCalendarDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addCalendarDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCalendarDays("2026-03-07", 2)).toBe("2026-03-09"); // spring forward 03/08
    expect(addCalendarDays("2026-10-31", 2)).toBe("2026-11-02"); // fall back 11/01
  });

  it("adds months and clamps to month end", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-08-15", 6)).toBe("2027-02-15");
  });

  it("counts days in both directions", () => {
    expect(daysBetween("2026-09-26", "2026-10-01")).toBe(5);
    expect(daysBetween("2026-10-01", "2026-09-26")).toBe(-5);
  });

  it("rejects impossible dates", () => {
    expect(() => addCalendarDays("2026-02-30", 1)).toThrow();
  });

  it("uses Eastern time for 'today'", () => {
    // 2026-09-27 02:30 UTC is still 09/26 in New York.
    expect(todayIn("America/New_York", new Date("2026-09-27T02:30:00Z"))).toBe("2026-09-26");
    expect(todayIn("America/Chicago", new Date("2026-09-27T04:30:00Z"))).toBe("2026-09-26");
  });

  it("computes 2026 federal holidays with observance", () => {
    expect(federalHolidays(2026)).toEqual([
      "2026-01-01",
      "2026-01-19",
      "2026-02-16",
      "2026-05-25",
      "2026-06-19",
      "2026-07-03", // July 4 is a Saturday
      "2026-09-07",
      "2026-10-12",
      "2026-11-11",
      "2026-11-26",
      "2026-12-25",
    ]);
  });

  it("treats weekends and observed holidays as non-business days", () => {
    expect(isBusinessDay("2026-09-25")).toBe(true); // Friday
    expect(isBusinessDay("2026-09-26")).toBe(false); // Saturday
    expect(isBusinessDay("2026-07-03")).toBe(false); // observed Independence Day
    expect(isBusinessDay("2021-12-31")).toBe(false); // observed New Year's Day 2022
  });
});

describe("Florida legal holidays (§ 110.117 via Rule 2.514(a)(6), ⚠️ VERIFY)", () => {
  it("lists 2026 state paid holidays with observance", () => {
    expect(floridaHolidays(2026)).toEqual([
      "2026-01-01",
      "2026-01-19",
      "2026-05-25",
      "2026-07-03", // July 4 is a Saturday
      "2026-09-07",
      "2026-11-11",
      "2026-11-26",
      "2026-11-27",
      "2026-12-25",
    ]);
  });

  it.each([
    ["2026-11-27", "fl_legal_holiday", "2026-11-30"],
    ["2026-11-27", "federal_holiday", "2026-11-27"],
    ["2026-06-19", "fl_legal_holiday", "2026-06-19"],
    ["2026-06-19", "federal_holiday", "2026-06-22"],
    ["2026-10-12", "federal_holiday", "2026-10-13"],
    ["2026-10-12", "fl_legal_holiday", "2026-10-12"],
    ["2026-03-07", "fl_legal_holiday", "2026-03-09"],
    ["2026-03-09", "federal_holiday", "2026-03-09"],
  ] as const)("%s rolls forward under %s to %s", (date, cal, expected) => {
    expect(rollForwardToBusinessDay(date, holidayCalendars[cal])).toBe(expected);
  });
});

describe("isValidIsoDate", () => {
  it("accepts a real calendar date", () => {
    expect(isValidIsoDate("2026-02-28")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true); // leap year
  });

  it("rejects a date that doesn't exist", () => {
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isValidIsoDate("2023-02-29")).toBe(false); // not a leap year
    expect(isValidIsoDate("not-a-date")).toBe(false);
  });
});

describe("easternDayBoundsUtc", () => {
  it("bounds a winter (EST, UTC-5) day", () => {
    const { start, endExclusive } = easternDayBoundsUtc("2026-01-15");
    expect(start.toISOString()).toBe("2026-01-15T05:00:00.000Z");
    expect(endExclusive.toISOString()).toBe("2026-01-16T05:00:00.000Z");
  });

  it("bounds a summer (EDT, UTC-4) day", () => {
    const { start, endExclusive } = easternDayBoundsUtc("2026-07-15");
    expect(start.toISOString()).toBe("2026-07-15T04:00:00.000Z");
    expect(endExclusive.toISOString()).toBe("2026-07-16T04:00:00.000Z");
  });

  it("is exactly 24 hours across a non-DST-transition day", () => {
    const { start, endExclusive } = easternDayBoundsUtc("2026-03-01");
    expect(endExclusive.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
