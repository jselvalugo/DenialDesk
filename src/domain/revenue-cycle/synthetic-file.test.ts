import { describe, expect, it } from "vitest";
import { DEFAULT_GL_ACCOUNTS, DEFAULT_PAYER_CLASSES, DEFAULT_RULES } from "./defaults";
import { prepareEngine } from "./engine";
import { parseMonthlyFile } from "./monthly-file";
import { generateMonthlyFiles, generateMonthlyLines, monthlyLinesToCsv } from "./synthetic-file";

const options = { seed: 3, periodYear: 2026, periodMonth: 2, months: 6, facilities: ["North Clinic"] };
const files = generateMonthlyFiles(options);

describe("synthetic monthly activity files", () => {
  it("round-trip through the importer's parser in synthetic-only mode", () => {
    const lines = files.at(-1)!.lines;
    const parsed = parseMonthlyFile(monthlyLinesToCsv(lines), { syntheticOnly: true });
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.lines).toEqual(lines);
  });

  it("cover consecutive months, never date service after the period, and are deterministic", () => {
    expect(files.map((f) => `${f.periodYear}-${f.periodMonth}`)).toEqual([
      "2025-9",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-1",
      "2026-2",
    ]);
    const last = files.at(-1)!.lines;
    expect(last.every((l) => l.serviceDate <= "2026-02-28")).toBe(true);
    expect(last.some((l) => l.serviceDate < "2026-02-01" && l.billedCents === 0)).toBe(true);
    expect(generateMonthlyFiles(options)).toEqual(files);
    expect(generateMonthlyLines({ ...options, lines: 120 })).toEqual(
      generateMonthlyFiles({ ...options, months: 4 }).at(-1)!.lines,
    );
  });

  it("roll forward exactly: opening balance + charges − payments − adjustments = closing balance", () => {
    const total = (
      lines: (typeof files)[number]["lines"],
      key: "billedCents" | "paymentCents" | "adjustmentCents" | "balanceCents",
    ) => lines.reduce((t, l) => t + l[key], 0);
    for (let i = 1; i < files.length; i++) {
      const { lines } = files[i]!;
      expect(
        total(files[i - 1]!.lines, "balanceCents") +
          total(lines, "billedCents") -
          total(lines, "paymentCents") -
          total(lines, "adjustmentCents"),
      ).toBe(total(lines, "balanceCents"));
    }
    expect(files.every((f) => f.lines.every((l) => l.balanceCents >= 0))).toBe(true);
  });

  it("exercise every starter rule", () => {
    const classify = prepareEngine({
      rules: DEFAULT_RULES.map((r) => ({ ...r, active: true })),
      payerClasses: DEFAULT_PAYER_CLASSES,
      arAccounts: DEFAULT_GL_ACCOUNTS.filter((a) => a.kind === "ar").map((a) => ({
        number: a.number,
        revenueGl: a.revenueGl!,
        adjustmentGl: a.adjustmentGl!,
      })),
      defaultArGl: "1200",
    });
    const used = new Set(files.flatMap((f) => f.lines.map((l) => classify(l).ruleCode)));
    expect([...used].sort()).toEqual(DEFAULT_RULES.map((r) => r.code).sort());
    // Lines that reach the ledger in later months: a void after posting, an invalid code paid later.
    expect(files.some((f) => f.lines.some((l) => l.status === "VOID" && l.billedCents === 0))).toBe(true);
    expect(
      files.some((f) => f.lines.some((l) => l.cpt === "9921" && l.billedCents === 0 && l.paymentCents > 0)),
    ).toBe(true);
  });
});
