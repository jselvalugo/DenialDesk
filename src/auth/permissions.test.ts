import { describe, expect, it } from "vitest";
import { canCorrectClaims } from "./permissions";

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
