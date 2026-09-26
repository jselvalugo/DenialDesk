import { describe, expect, it } from "vitest";
import {
  contraCents,
  describeMatch,
  EngineConfigError,
  prepareEngine,
  ruleMatchSchema,
  type EngineConfig,
  type LineInput,
} from "@/domain/revenue-cycle/engine";
import { DEFAULT_GL_ACCOUNTS, DEFAULT_PAYER_CLASSES, DEFAULT_RULES } from "@/domain/revenue-cycle/defaults";

const config: EngineConfig = {
  rules: DEFAULT_RULES.map((r) => ({ ...r, active: true })),
  payerClasses: DEFAULT_PAYER_CLASSES,
  arAccounts: DEFAULT_GL_ACCOUNTS.filter((a) => a.kind === "ar").map((a) => ({
    number: a.number,
    revenueGl: a.revenueGl!,
    adjustmentGl: a.adjustmentGl!,
  })),
  defaultArGl: "1310",
};
const classify = prepareEngine(config);

const line = (overrides: Partial<LineInput> = {}): LineInput => ({
  status: "PAID",
  payerClass: "COM",
  cpt: "99213",
  description: "Office visit",
  facility: "Main clinic",
  billedCents: 15_000,
  ...overrides,
});

/**
 * Reference: the original RevCycle IQ `applyRulesEngine` (rulesEngine.ts, 2026-05-05), with the
 * charge in cents. The configurable engine seeded with the defaults must agree with it exactly.
 */
function reference(row: LineInput) {
  const MEDICARE = new Set(["MCR", "MCRMCF", "MCRMCC", "MCDMCC"]);
  const SELF = new Set(["Patient", "SPY", "SELF", "SELFPAY"]);
  const CAP = new Set(["MCDMCC", "MCRMCC"]);
  const CASH = new Set(["COPYC", "ESPEJ", "CERTM"]);
  const { cpt, status, payerClass: pc, description, facility } = row;
  let rule = "STANDARD";
  let pct = 0;
  if (status === "INTEC" || description.toLowerCase().includes("interest")) rule = "INTEREST";
  else if (CASH.has(pc)) rule = "CASH_BASIS_OTHER";
  else if (status === "51CR") [rule, pct] = ["EXCL_51CR", 1];
  else if (cpt.charAt(0) === "F" || cpt.charAt(cpt.length - 1) === "F") [rule, pct] = ["EXCL_FCODE", 1];
  else if (facility.toLowerCase().includes("comunitaria")) [rule, pct] = ["EXCL_FACILIDAD_COM", 1];
  else if (cpt === "G0467") rule = "G0467_FQHC";
  else if (cpt === "90471" || cpt === "90472") rule = "VFC_IMMUN";
  else if (!/^[A-Za-z0-9]{5}$/.test(cpt)) [rule, pct] = ["INVALID_CPT", 1];
  else if (MEDICARE.has(pc) && (pc.startsWith("MCR") || pc.startsWith("MCD")))
    [rule, pct] = ["WRAP_PPS_MEDICARE", 1];
  else if (SELF.has(pc)) rule = "SELF_PAY";
  else if (CAP.has(pc)) [rule, pct] = ["CAPITATION", 1];
  const ar =
    rule === "SELF_PAY"
      ? "1320"
      : ["INTEREST", "WRAP_PPS_MEDICARE", "CAPITATION", "G0467_FQHC"].includes(rule) || MEDICARE.has(pc)
        ? "1330"
        : "1310";
  const rev = rule === "INTEREST" ? "5520" : rule === "SELF_PAY" ? "5410" : ar === "1330" ? "5310" : "5210";
  const adj = rule === "SELF_PAY" ? "5411" : ar === "1330" ? "5311" : "5211";
  const contra = Math.round(row.billedCents * pct);
  return { ruleCode: rule, arGl: ar, revenueGl: rev, adjustmentGl: adj, contraCents: contra };
}

describe("revenue cycle rules engine with the RevCycle IQ defaults", () => {
  it.each([
    ["interest status", line({ status: "INTEC" }), "INTEREST", "1330", "5520", "5311", 0],
    [
      "interest description",
      line({ description: "Late INTEREST payment" }),
      "INTEREST",
      "1330",
      "5520",
      "5311",
      0,
    ],
    ["cash-basis class", line({ payerClass: "ESPEJ" }), "CASH_BASIS_OTHER", "1310", "5210", "5211", 0],
    ["51CR", line({ status: "51CR" }), "EXCL_51CR", "1310", "5210", "5211", 15_000],
    ["leading F", line({ cpt: "F1234" }), "EXCL_FCODE", "1310", "5210", "5211", 15_000],
    ["trailing F", line({ cpt: "3044F" }), "EXCL_FCODE", "1310", "5210", "5211", 15_000],
    [
      "community facility",
      line({ facility: "Centro COMUNITARIA" }),
      "EXCL_FACILIDAD_COM",
      "1310",
      "5210",
      "5211",
      15_000,
    ],
    ["G0467", line({ cpt: "G0467", payerClass: "COM" }), "G0467_FQHC", "1330", "5310", "5311", 0],
    ["VFC", line({ cpt: "90472" }), "VFC_IMMUN", "1310", "5210", "5211", 0],
    ["invalid CPT", line({ cpt: "9921" }), "INVALID_CPT", "1310", "5210", "5211", 15_000],
    ["blank CPT", line({ cpt: "" }), "INVALID_CPT", "1310", "5210", "5211", 15_000],
    ["Medicare wrap", line({ payerClass: "MCR" }), "WRAP_PPS_MEDICARE", "1330", "5310", "5311", 15_000],
    [
      "capitated class hits the wrap rule first",
      line({ payerClass: "MCDMCC" }),
      "WRAP_PPS_MEDICARE",
      "1330",
      "5310",
      "5311",
      15_000,
    ],
    ["self-pay", line({ payerClass: "SPY" }), "SELF_PAY", "1320", "5410", "5411", 0],
    ["standard", line(), "STANDARD", "1310", "5210", "5211", 0],
  ])("%s", (_name, input, ruleCode, arGl, revenueGl, adjustmentGl, contra) => {
    const result = classify(input);
    expect(result).toMatchObject({ ruleCode, arGl, revenueGl, adjustmentGl, contraCents: contra });
    expect(result.netCents).toBe(input.billedCents - contra);
  });

  it("agrees with the original RevCycle IQ engine on 5,000 generated lines", () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
    const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
    const classes = [...DEFAULT_PAYER_CLASSES.map((p) => p.code), "BCBS", "", "mcr"];
    const cpts = [
      "99213",
      "G0467",
      "90471",
      "90472",
      "F1234",
      "3044F",
      "9921",
      "",
      "A1B2C",
      "99214X",
      "G0468",
    ];
    for (let i = 0; i < 5_000; i++) {
      const input = line({
        status: pick(["PAID", "INTEC", "51CR", "DENIED", "", "INTEC "]),
        payerClass: pick([...classes, "MCR ", " SPY"]),
        cpt: pick(cpts),
        description: pick(["Office visit", "Interest adj", "Flu shot"]),
        facility: pick(["Main clinic", "Sala Comunitaria", "Annex"]),
        billedCents: Math.floor(rand() * 200_000) - 10_000,
      });
      const ours = classify(input);
      expect({
        ruleCode: ours.ruleCode,
        arGl: ours.arGl,
        revenueGl: ours.revenueGl,
        adjustmentGl: ours.adjustmentGl,
        contraCents: ours.contraCents,
      }).toEqual(reference(input));
    }
  });
});

describe("engine configuration", () => {
  it("skips inactive rules", () => {
    const withoutWrap = prepareEngine({
      ...config,
      rules: config.rules.map((r) => (r.code === "WRAP_PPS_MEDICARE" ? { ...r, active: false } : r)),
    });
    expect(withoutWrap(line({ payerClass: "MCRMCC" })).ruleCode).toBe("CAPITATION");
    expect(withoutWrap(line({ payerClass: "MCR" })).ruleCode).toBe("STANDARD");
    expect(withoutWrap(line({ payerClass: "MCR" })).arGl).toBe("1330"); // from the payer class
  });

  it("requires a fallback rule", () => {
    expect(() =>
      prepareEngine({ ...config, rules: config.rules.filter((r) => r.code !== "STANDARD") }),
    ).toThrow(EngineConfigError);
  });

  it("rejects out-of-range contra percentages and unknown AR accounts", () => {
    expect(() =>
      prepareEngine({ ...config, rules: config.rules.map((r) => ({ ...r, contraBps: 10_001 })) }),
    ).toThrow(EngineConfigError);
    expect(() => prepareEngine({ ...config, defaultArGl: "9999" })).toThrow(EngineConfigError);
    expect(() => prepareEngine({ ...config, payerClasses: [{ code: "COM", arGl: "1399" }] })).toThrow(/1399/);
    expect(() =>
      prepareEngine({ ...config, rules: config.rules.map((r) => ({ ...r, arGl: r.arGl && "5210" })) }),
    ).toThrow(/5210/);
  });

  it("rejects non-integer money", () => {
    expect(() => classify(line({ billedCents: 10.5 }))).toThrow(EngineConfigError);
  });

  it("validates stored conditions against the fixed vocabulary", () => {
    expect(ruleMatchSchema.safeParse({ any: [{ op: "regex", field: "cpt", value: ".*" }] }).success).toBe(
      false,
    );
    expect(ruleMatchSchema.safeParse({ any: [] }).success).toBe(false);
    expect(ruleMatchSchema.safeParse({ always: true }).success).toBe(true);
    for (const r of DEFAULT_RULES) expect(ruleMatchSchema.safeParse(r.match).success).toBe(true);
  });
});

describe("contra rounding", () => {
  it("rounds half away from zero to the cent", () => {
    expect(contraCents(101, 5_000)).toBe(51);
    expect(contraCents(-101, 5_000)).toBe(-51);
    expect(contraCents(99_999, 10_000)).toBe(99_999);
    expect(contraCents(12_345, 0)).toBe(0);
  });
});

describe("rule descriptions", () => {
  it("renders conditions in plain English", () => {
    expect(describeMatch(DEFAULT_RULES[0]!.match)).toEqual([
      "Status is INTEC",
      'Description contains "interest"',
    ]);
    expect(describeMatch({ always: true })).toEqual(["Every line not matched by an earlier rule"]);
  });
});
