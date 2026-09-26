import { describe, expect, it } from "vitest";
import { CARC, CATEGORY_LABELS, categorize } from "./carc";

describe("categorize", () => {
  it("maps known CARCs to work-queue categories", () => {
    expect(categorize("197")).toBe("authorization");
    expect(categorize("50")).toBe("medical_necessity");
    expect(categorize("29")).toBe("timely_filing");
  });

  it("sends unknown codes to 'other' rather than guessing", () => {
    expect(categorize("999")).toBe("other");
  });

  it("labels every category used by the reference", () => {
    for (const { category } of Object.values(CARC)) expect(CATEGORY_LABELS[category]).toBeTruthy();
  });
});
