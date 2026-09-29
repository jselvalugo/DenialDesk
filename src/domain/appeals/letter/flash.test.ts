import { describe, expect, it } from "vitest";
import { isSavedFlash, letterSavedPath } from "./flash";

describe("letter saved flash", () => {
  it("redirects to the letter page with only the saved flag (no template, no record data)", () => {
    const path = letterSavedPath("0b7f6a52-2d3c-4f6e-9a55-6f8d1c2e3a4b");
    expect(path).toBe("/appeals/0b7f6a52-2d3c-4f6e-9a55-6f8d1c2e3a4b/letter?saved=1");
    expect(new URL(path, "http://x").searchParams.has("template")).toBe(false);
  });

  it("the page shows the notice only for the exact flag value the action sets", () => {
    expect(isSavedFlash("1")).toBe(true);
    for (const other of [undefined, "", "0", "true", "yes", ["1"], ["1", "1"]]) {
      expect(isSavedFlash(other)).toBe(false);
    }
  });
});
