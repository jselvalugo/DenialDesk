import { describe, expect, it } from "vitest";
import { hasRecentMfa } from "./step-up";

// Step-up MFA (R-7.2.2): the 5-minute window, exact boundaries (security review PR #81 asked for
// 4:59 / 5:00 / 5:01 explicitly, injecting the clock rather than relying on wall time).
describe("hasRecentMfa", () => {
  const verifiedAt = new Date("2026-09-28T12:00:00.000Z");

  it("is false with no verification on record", () => {
    expect(hasRecentMfa(null, new Date("2026-09-28T12:00:00.000Z"))).toBe(false);
  });

  it("is true at 4:59 since verification", () => {
    const now = new Date(verifiedAt.getTime() + 4 * 60_000 + 59_000);
    expect(hasRecentMfa(verifiedAt, now)).toBe(true);
  });

  it("is true at exactly 5:00 since verification (inclusive)", () => {
    const now = new Date(verifiedAt.getTime() + 5 * 60_000);
    expect(hasRecentMfa(verifiedAt, now)).toBe(true);
  });

  it("is false at 5:01 since verification", () => {
    const now = new Date(verifiedAt.getTime() + 5 * 60_000 + 1000);
    expect(hasRecentMfa(verifiedAt, now)).toBe(false);
  });

  it("is true at exactly 0 seconds (just verified)", () => {
    expect(hasRecentMfa(verifiedAt, verifiedAt)).toBe(true);
  });
});
