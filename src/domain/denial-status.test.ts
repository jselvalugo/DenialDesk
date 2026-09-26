import { describe, expect, it } from "vitest";
import { ACTION_STATUSES, OPEN_STATUSES, regimeLabel } from "./denial-status";

describe("denial statuses", () => {
  it("keeps submitted appeals open but off the deadline clock", () => {
    expect(OPEN_STATUSES).toContain("appeal_submitted");
    expect(ACTION_STATUSES).not.toContain("appeal_submitted");
  });

  it("only counts open statuses as awaiting action", () => {
    for (const status of ACTION_STATUSES) expect(OPEN_STATUSES).toContain(status);
    expect(ACTION_STATUSES).toEqual(["new", "in_review", "needs_records", "appeal_drafted"]);
  });
});

describe("regimeLabel (spec: payer-catalog P1)", () => {
  it("labels a known regime", () => {
    expect(regimeLabel("fl_insurer")).toBe("FL commercial");
  });

  it("labels a null regime as not verified rather than throwing", () => {
    expect(regimeLabel(null)).toBe("Regime not verified");
  });
});
