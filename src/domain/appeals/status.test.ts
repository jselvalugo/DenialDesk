import { describe, expect, it } from "vitest";
import { denialStatusForDecision, isCloseOutcome } from "./status";

describe("isCloseOutcome", () => {
  it("treats withdrawn and dismissed as not a payer ruling on the merits", () => {
    expect(isCloseOutcome("withdrawn")).toBe(true);
    expect(isCloseOutcome("dismissed")).toBe(true);
    expect(isCloseOutcome("upheld")).toBe(false);
    expect(isCloseOutcome("overturned_full")).toBe(false);
    expect(isCloseOutcome("overturned_partial")).toBe(false);
  });
});

describe("denialStatusForDecision", () => {
  it("maps a decision outcome to the denial status it syncs to", () => {
    expect(denialStatusForDecision("overturned_full")).toBe("overturned");
    expect(denialStatusForDecision("overturned_partial")).toBe("overturned");
    expect(denialStatusForDecision("upheld")).toBe("upheld");
    expect(denialStatusForDecision("withdrawn")).toBe("closed");
    expect(denialStatusForDecision("dismissed")).toBe("closed");
  });
});
