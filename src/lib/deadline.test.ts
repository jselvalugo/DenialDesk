import { describe, expect, it } from "vitest";
import { deadlineTone, describeDaysRemaining } from "./deadline";

describe("deadlineTone", () => {
  it("is danger once overdue", () => {
    expect(deadlineTone(-1, 7)).toBe("danger");
  });

  it("is warning from the day it is due through the due-soon window", () => {
    expect(deadlineTone(0, 7)).toBe("warning");
    expect(deadlineTone(7, 7)).toBe("warning");
  });

  it("is neutral the day after the window ends", () => {
    expect(deadlineTone(8, 7)).toBe("neutral");
  });

  it("rejects fractional days", () => {
    expect(() => deadlineTone(1.5, 7)).toThrow();
  });
});

describe("describeDaysRemaining", () => {
  it.each([
    [-3, "3 days overdue"],
    [-1, "1 day overdue"],
    [0, "Due today"],
    [1, "1 day left"],
    [14, "14 days left"],
  ])("%i → %s", (days, text) => {
    expect(describeDaysRemaining(days)).toBe(text);
  });
});
