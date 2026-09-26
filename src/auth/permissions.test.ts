import { describe, expect, it } from "vitest";
import { canCorrectClaims, canEditPatients, canTagSensitivity } from "./permissions";

describe("claim corrections (R-5.1.2, R-3.10.1)", () => {
  it.each([
    ["admin", true],
    ["manager", true],
    ["specialist", true],
    ["compliance", false],
  ] as const)("%s can correct claims: %s", (role, allowed) => {
    expect(canCorrectClaims(role)).toBe(allowed);
  });
});

describe("patient records (R-5.1.2, R-3.5.1)", () => {
  it.each([
    ["admin", true, true],
    ["manager", true, false],
    ["specialist", true, false],
    ["compliance", false, false],
  ] as const)("%s edits patients: %s, tags sensitivity: %s", (role, edit, tag) => {
    expect(canEditPatients(role)).toBe(edit);
    expect(canTagSensitivity(role)).toBe(tag);
  });
});
