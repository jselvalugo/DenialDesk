import { describe, expect, it } from "vitest";
import { en } from "@/i18n/messages/en";
import { createTranslator } from "@/i18n/translate";
import { ACTION_STATUSES, nextAppealSubmittedOn, OPEN_STATUSES, regimeLabel } from "./denial-status";

const t = createTranslator(en.common, "en");

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

describe("nextAppealSubmittedOn (F5)", () => {
  it("stamps today on first entry into appeal_submitted", () => {
    expect(nextAppealSubmittedOn("appeal_submitted", null, "2026-09-26")).toBe("2026-09-26");
  });

  it("re-stamps today on a later refiling, replacing the earlier date", () => {
    expect(nextAppealSubmittedOn("appeal_submitted", "2026-01-01", "2026-09-26")).toBe("2026-09-26");
  });

  it("leaves the stored date untouched for any other transition", () => {
    expect(nextAppealSubmittedOn("in_review", "2026-01-01", "2026-09-26")).toBe("2026-01-01");
    expect(nextAppealSubmittedOn("overturned", null, "2026-09-26")).toBeNull();
  });
});

describe("regimeLabel (spec: payer-catalog P1)", () => {
  it("labels a known regime", () => {
    expect(regimeLabel("fl_insurer", t)).toBe("FL commercial");
  });

  it("labels a null regime as not verified rather than throwing", () => {
    expect(regimeLabel(null, t)).toBe("Regime not verified");
  });
});
