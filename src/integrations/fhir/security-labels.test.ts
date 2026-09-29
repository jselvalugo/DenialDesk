import { describe, expect, it } from "vitest";
import {
  ACT_CODE_SYSTEM,
  classifySecurityLabels,
  CONFIDENTIALITY_SYSTEM,
  SENSITIVITY_VOCABULARY,
} from "./security-labels";

// docs/specs/patient-integrations.md "Field mapping" (`source_restricted`, `source_sensitivity`) and
// threat model I4: a patient is restricted when the source labels them R or V, with an ActCode
// sensitivity code, or with anything we don't recognize.

const conf = (code: string) => ({ system: CONFIDENTIALITY_SYSTEM, code });
const act = (code: string) => ({ system: ACT_CODE_SYSTEM, code });

describe("classifySecurityLabels", () => {
  it("no labels: not restricted", () => {
    expect(classifySecurityLabels(undefined)).toEqual({ restricted: false, sensitivity: [] });
    expect(classifySecurityLabels([])).toEqual({ restricted: false, sensitivity: [] });
  });

  it.each(["U", "L", "M", "N"])("confidentiality %s does not restrict", (code) => {
    expect(classifySecurityLabels([conf(code)])).toEqual({ restricted: false, sensitivity: [] });
  });

  it.each(["R", "V"])("confidentiality %s restricts", (code) => {
    expect(classifySecurityLabels([conf(code)])).toEqual({ restricted: true, sensitivity: [code] });
  });

  it.each(["HIV", "PSY", "ETH", "SDV", "42CFRPart2"])("ActCode sensitivity %s restricts", (code) => {
    expect(classifySecurityLabels([act(code)])).toEqual({ restricted: true, sensitivity: [code] });
  });

  it("any unrecognized label restricts and is stored as `unknown`, never verbatim", () => {
    const result = classifySecurityLabels([
      { system: "https://vendor.example/labels", code: "SPECIAL-SECRET" },
    ]);
    expect(result).toEqual({ restricted: true, sensitivity: ["unknown"] });
    expect(JSON.stringify(result)).not.toContain("SPECIAL");
  });

  it("a recognized code under the wrong system, an unlisted code, or no code at all is unrecognized", () => {
    expect(
      classifySecurityLabels([{ system: "https://vendor.example/labels", code: "R" }]).sensitivity,
    ).toEqual(["unknown"]);
    expect(classifySecurityLabels([act("ABC")]).sensitivity).toEqual(["unknown"]);
    expect(classifySecurityLabels([conf("X")]).sensitivity).toEqual(["unknown"]);
    expect(classifySecurityLabels([{ system: CONFIDENTIALITY_SYSTEM }]).sensitivity).toEqual(["unknown"]);
    expect(classifySecurityLabels([{}]).sensitivity).toEqual(["unknown"]);
  });

  it("combines labels, de-duplicated, in vocabulary order; a non-restricting one alongside does not mask", () => {
    const result = classifySecurityLabels([act("HIV"), conf("N"), conf("R"), act("HIV"), { code: "?" }]);
    expect(result).toEqual({ restricted: true, sensitivity: ["R", "HIV", "unknown"] });
  });

  it("only ever returns codes the database CHECK allows (patients_source_sensitivity_valid)", () => {
    expect(SENSITIVITY_VOCABULARY).toEqual(["R", "V", "HIV", "PSY", "ETH", "SDV", "42CFRPart2", "unknown"]);
  });
});
