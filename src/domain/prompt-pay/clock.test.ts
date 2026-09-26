import { describe, expect, it } from "vitest";
import { clockDay, effectiveResponses } from "./clock";

describe("effectiveResponses", () => {
  it("drops responses recorded in error and the correction rows themselves", () => {
    const rows = [
      { id: "a", kind: "contest" as const, responseDate: "2026-01-10", cents: 0, voidsResponseId: null },
      { id: "b", kind: "contest" as const, responseDate: "2026-01-10", cents: 0, voidsResponseId: "a" },
      { id: "c", kind: "payment" as const, responseDate: "2026-01-20", cents: 5_000, voidsResponseId: null },
    ];
    expect(effectiveResponses(rows)).toEqual([{ kind: "payment", date: "2026-01-20", cents: 5_000 }]);
  });
});

describe("clockDay", () => {
  it("reports the latest alert day reached while the clock is open (day before / of / after)", () => {
    expect(clockDay("2026-01-01", "2026-01-15", true)).toEqual({ day: 14, alert: null });
    expect(clockDay("2026-01-01", "2026-01-16", true)).toEqual({ day: 15, alert: 15 });
    expect(clockDay("2026-01-01", "2026-01-17", true)).toEqual({ day: 16, alert: 15 });
    expect(clockDay("2026-01-01", "2026-03-02", true)).toEqual({ day: 60, alert: 60 });
  });

  it("raises no alert once the payer has answered", () => {
    expect(clockDay("2026-01-01", "2026-03-02", false)).toEqual({ day: 60, alert: null });
  });
});
