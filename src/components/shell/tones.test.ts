import { describe, expect, it } from "vitest";
import { toneClasses } from "./tones";

describe("toneClasses", () => {
  it("styles every module tile as a colored glyph on a tint, never a solid square (ADR 0005)", () => {
    for (const classes of Object.values(toneClasses)) {
      expect(classes).toMatch(/\bbg-tile-/);
      expect(classes).toMatch(/\btext-tile-/);
      expect(classes).toMatch(/\bborder-tile-/);
      expect(classes).not.toMatch(/text-white|bg-chart-|bg-neutral-fg/);
    }
  });
});
