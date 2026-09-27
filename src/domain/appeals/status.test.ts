import { describe, expect, it } from "vitest";
import { addCalendarDays } from "@rules/calendar";
import { denialStatusForDecision, isCloseOutcome, submissionTimeliness } from "./status";

describe("isCloseOutcome", () => {
  it("treats withdrawn and dismissed as not a payer ruling on the merits", () => {
    expect(isCloseOutcome("withdrawn")).toBe(true);
    expect(isCloseOutcome("dismissed")).toBe(true);
    expect(isCloseOutcome("upheld")).toBe(false);
    expect(isCloseOutcome("overturned_full")).toBe(false);
    expect(isCloseOutcome("overturned_partial")).toBe(false);
  });
});

describe("submissionTimeliness", () => {
  const deadline = "2026-06-15";

  it.each([
    [addCalendarDays(deadline, -1), "on_time"], // day before
    [deadline, "on_time"], // day of (the deadline day itself counts as on time)
    [addCalendarDays(deadline, 1), "late"], // day after
  ])("submitted on %s against deadline " + deadline + " reads %s", (submittedOn, expected) => {
    expect(submissionTimeliness(submittedOn, deadline)).toBe(expected);
  });

  it("is null when there's no deadline to compare against", () => {
    expect(submissionTimeliness("2026-06-15", null)).toBeNull();
  });
});

describe("denialStatusForDecision", () => {
  it("maps a decision outcome to the denial status it syncs to", () => {
    expect(denialStatusForDecision("overturned_full")).toBe("overturned");
    expect(denialStatusForDecision("overturned_partial")).toBe("overturned");
    expect(denialStatusForDecision("upheld")).toBe("upheld");
    expect(denialStatusForDecision("withdrawn")).toBe("closed");
    expect(denialStatusForDecision("dismissed")).toBe("closed");
  });
});
