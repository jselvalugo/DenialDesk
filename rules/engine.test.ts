import { describe, expect, it } from "vitest";
import { ALL_REGIMES, catalog } from "./catalog";
import { ruleDueDate } from "./deadlines";
import { resolveRule } from "./engine";
import type { Rule } from "./types";

const base: Rule = {
  id: "test.rule",
  title: "Test",
  citation: "Test § 1",
  regimes: ["fl_insurer"],
  value: 10,
  unit: "calendar_days",
  anchor: "payer_receipt",
  rollForward: "none",
  side: "provider",
  confirmedBy: null,
  effectiveFrom: null,
  effectiveTo: "2027-01-01",
  verify: true,
};
const next: Rule = { ...base, value: 15, effectiveFrom: "2027-01-01", effectiveTo: null };

describe("resolveRule", () => {
  it("picks the version in force: day before, day of, and day after a change", () => {
    expect(resolveRule("test.rule", "2026-12-31", [base, next]).value).toBe(10);
    expect(resolveRule("test.rule", "2027-01-01", [base, next]).value).toBe(15);
    expect(resolveRule("test.rule", "2027-01-02", [base, next]).value).toBe(15);
  });

  it("throws for unknown rules and overlapping versions", () => {
    expect(() => resolveRule("missing", "2026-01-01", [base])).toThrow(/No rule/);
    expect(() => resolveRule("test.rule", "2026-06-01", [base, { ...base, value: 11 }])).toThrow(
      /Overlapping/,
    );
  });
});

describe("catalog", () => {
  it("gives every rule a citation and keeps every rule flagged for counsel review", () => {
    for (const rule of catalog) {
      expect(rule.citation.length, rule.id).toBeGreaterThan(0);
      expect(rule.verify, rule.id).toBe(true);
    }
  });

  it("has no overlapping versions", () => {
    for (const rule of catalog) {
      const asOf = rule.effectiveFrom ?? "2026-09-26";
      expect(() => resolveRule(rule.id, asOf)).not.toThrow();
    }
  });

  it("never records a confirmation while verify is still true, and every date period has an anchor", () => {
    for (const rule of catalog) {
      expect(rule.confirmedBy, rule.id).toBeNull();
      if (rule.unit !== "percent_per_year") expect(rule.anchor, rule.id).not.toBeNull();
    }
  });

  it("keeps Florida insurer and HMO rule sets separate, with HMO rules citing § 641.3155", () => {
    for (const rule of catalog.filter((r) => r.id.startsWith("fl.hmo."))) {
      expect(rule.regimes, rule.id).toEqual(["fl_hmo"]);
      expect(rule.citation, rule.id).toMatch(/§ 641\.3155/);
      expect(
        catalog.some((r) => r.id === rule.id.replace("fl.hmo.", "fl.")),
        rule.id,
      ).toBe(true);
    }
    for (const rule of catalog.filter((r) => r.id.startsWith("fl.") && !r.id.startsWith("fl.hmo."))) {
      if (rule.id === "fl.patient_refund") expect(rule.regimes).toEqual(ALL_REGIMES);
      else expect(rule.regimes.includes("fl_hmo"), rule.id).toBe(false);
    }
  });

  it("never lets Florida rules apply to Medicare, MA or self-funded ERISA, except the patient refund rule", () => {
    for (const rule of catalog.filter((r) => r.id.startsWith("fl.") && r.id !== "fl.patient_refund")) {
      for (const regime of ["medicare", "medicare_advantage", "erisa_self_funded"] as const) {
        expect(rule.regimes.includes(regime), `${rule.id} ${regime}`).toBe(false);
      }
    }
  });

  it("has unique rule IDs across the insurer, HMO, Medicare and shared sets (one entry per ID and version)", () => {
    const keys = catalog.map((r) => `${r.id}@${r.effectiveFrom ?? "baseline"}`);
    expect(new Set(keys).size).toBe(keys.length);
    const hmo = catalog.filter((r) => r.id.startsWith("fl.hmo.")).map((r) => r.id);
    const rest = new Set(catalog.filter((r) => !r.id.startsWith("fl.hmo.")).map((r) => r.id));
    expect(hmo.length).toBeGreaterThan(0);
    for (const id of hmo) expect(rest.has(id), id).toBe(false);
  });

  it("marks payer obligations side: payer and everything the practice files side: provider", () => {
    const side = (id: string) => catalog.find((r) => r.id === id)!.side;
    for (const id of [
      "fl.promptpay.electronic.pay_or_contest",
      "fl.hmo.promptpay.paper.uncontestable",
      "fl.promptpay.interest_rate",
    ])
      expect(side(id), id).toBe("payer");
    for (const id of [
      "fl.timely_filing.initial",
      "fl.timely_filing.secondary",
      "fl.promptpay.electronic.provider_response",
      "fl.overpayment.provider_response",
      "fl.patient_refund",
      "medicare.timely_filing",
      "medicare.redetermination.filing_window",
      "medicare.alj.filing_window",
    ])
      expect(side(id), id).toBe("provider");
  });
});

describe("ruleDueDate", () => {
  it.each(["fl.promptpay.electronic.acknowledgment", "fl.hmo.promptpay.electronic.acknowledgment"])(
    "throws for an hours_after_next_business_day rule (%s)",
    (id) => {
      expect(() => ruleDueDate(resolveRule(id, "2026-09-26"), "2026-09-26")).toThrow(/not a date period/);
    },
  );

  it("throws for a business_days rule", () => {
    expect(() => ruleDueDate({ ...base, unit: "business_days" }, "2026-09-26")).toThrow(/not a date period/);
  });
});
