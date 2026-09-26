import { describe, expect, it } from "vitest";
import { parseMonthlyFile } from "./monthly-file";
import { generateMonthlyLines, monthlyLinesToCsv } from "./synthetic-file";

describe("synthetic monthly file", () => {
  const lines = generateMonthlyLines({
    seed: 3,
    periodYear: 2026,
    periodMonth: 2,
    facilities: ["North Clinic"],
    lines: 400,
  });

  it("round-trips through the importer's parser in synthetic-only mode", () => {
    const parsed = parseMonthlyFile(monthlyLinesToCsv(lines), { syntheticOnly: true });
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.lines).toEqual(lines);
  });

  it("stays inside the period and is deterministic", () => {
    expect(lines.every((l) => l.serviceDate >= "2026-02-01" && l.serviceDate <= "2026-02-28")).toBe(true);
    expect(
      generateMonthlyLines({
        seed: 3,
        periodYear: 2026,
        periodMonth: 2,
        facilities: ["North Clinic"],
        lines: 400,
      }),
    ).toEqual(lines);
    expect(lines.every((l) => l.balanceCents === l.billedCents - l.paymentCents)).toBe(true);
  });
});
