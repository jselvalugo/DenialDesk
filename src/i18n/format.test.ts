import { describe, expect, it } from "vitest";
import { createFormatters } from "./format";

const now = new Date("2026-09-28T18:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("relative (data-source drop-down, specs/erp-shell.md)", () => {
  it("uses whole minutes under an hour, hours under a day, then days", () => {
    const f = createFormatters("en");
    expect(f.relative(ago(20_000), now)).toBe("this minute");
    expect(f.relative(ago(5 * 60_000), now)).toBe("5 minutes ago");
    expect(f.relative(ago(59 * 60_000), now)).toBe("59 minutes ago");
    expect(f.relative(ago(2 * 3_600_000 + 5 * 60_000), now)).toBe("2 hours ago");
    expect(f.relative(ago(26 * 3_600_000), now)).toBe("yesterday");
    expect(f.relative(ago(3 * 86_400_000), now)).toBe("3 days ago");
  });

  it("switches unit exactly at the hour and the day, and never reads as the future", () => {
    const f = createFormatters("en");
    expect(f.relative(ago(59 * 60_000 + 59_000), now)).toBe("59 minutes ago");
    expect(f.relative(ago(60 * 60_000), now)).toBe("1 hour ago");
    expect(f.relative(ago(23 * 3_600_000 + 59 * 60_000), now)).toBe("23 hours ago");
    expect(f.relative(ago(24 * 3_600_000), now)).toBe("yesterday");
    // A timestamp slightly ahead of the render time (clock skew) is "this minute", not "in 2 minutes".
    expect(f.relative(new Date(now.getTime() + 2 * 60_000), now)).toBe("this minute");
  });

  it("follows the language", () => {
    expect(createFormatters("es").relative(ago(5 * 60_000), now)).toBe("hace 5 minutos");
    expect(createFormatters("pt").relative(ago(5 * 60_000), now)).toBe("há 5 minutos");
  });
});
