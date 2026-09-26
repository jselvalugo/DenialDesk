import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv/parse";
import { DEFAULT_GL_ACCOUNTS } from "./defaults";
import {
  allPassed,
  balanceKey,
  buildVoucherLines,
  checkVoucher,
  voucherCsv,
  voucherNumber,
  type AccountKind,
  type VoucherGroup,
} from "./journal";

const accounts = new Map<string, AccountKind>(DEFAULT_GL_ACCOUNTS.map((a) => [a.number, a.kind]));

const group = (overrides: Partial<VoucherGroup> = {}): VoucherGroup => ({
  siteCode: "00",
  arGl: "1200",
  revenueGl: "4000",
  adjustmentGl: "4050",
  grossCents: 100_000,
  adjustmentCents: 30_000,
  paymentCents: 45_000,
  ...overrides,
});

const groups = [
  group(),
  group({ siteCode: "01", arGl: "1210", revenueGl: "4100", adjustmentGl: "4150", grossCents: 50_000 }),
  // An older-lines-only group: no new charges this month, only write-offs and payments.
  group({ siteCode: "01", grossCents: 0, adjustmentCents: 12_000, paymentCents: 8_000 }),
];
const source = (gs: VoucherGroup[]) => ({
  grossCents: gs.reduce((t, g) => t + g.grossCents, 0),
  adjustmentCents: gs.reduce((t, g) => t + g.adjustmentCents, 0),
  paymentCents: gs.reduce((t, g) => t + g.paymentCents, 0),
});
const lines = buildVoucherLines(groups, 2026, 3, "1050");
const firstMonth = { opening: null, closing: new Map<string, number>() };
const check = (overrides: Partial<Parameters<typeof checkVoucher>[0]> = {}) =>
  checkVoucher({
    lines,
    source: source(groups),
    accounts,
    otherPostedVoucher: null,
    balances: firstMonth,
    ...overrides,
  });

describe("buildVoucherLines", () => {
  it("posts charges, adjustments, and payments in balanced pairs, sorted by site and account", () => {
    expect(lines.map((l) => [l.role, l.account, l.siteCode, l.debitCents, l.creditCents])).toEqual([
      ["charges", "1200", "00", 100_000, 0],
      ["charges", "4000", "00", 0, 100_000],
      ["adjustments", "4050", "00", 30_000, 0],
      ["adjustments", "1200", "00", 0, 30_000],
      ["payments", "1050", "00", 45_000, 0],
      ["payments", "1200", "00", 0, 45_000],
      // Site 01: the 1200 group sorts before the 1210 group; its zero charges post nothing.
      ["adjustments", "4050", "01", 12_000, 0],
      ["adjustments", "1200", "01", 0, 12_000],
      ["payments", "1050", "01", 8_000, 0],
      ["payments", "1200", "01", 0, 8_000],
      ["charges", "1210", "01", 50_000, 0],
      ["charges", "4100", "01", 0, 50_000],
      ["adjustments", "4150", "01", 30_000, 0],
      ["adjustments", "1210", "01", 0, 30_000],
      ["payments", "1050", "01", 45_000, 0],
      ["payments", "1210", "01", 0, 45_000],
    ]);
    expect(lines.map((l) => l.lineNumber)).toEqual(lines.map((_, i) => i + 1));
    expect(lines[0]!.memo).toBe("Patient charges Mar 2026, site 00");
  });

  it("swaps sides for net reversals", () => {
    const reversed = buildVoucherLines(
      [group({ grossCents: -5_000, adjustmentCents: -1_000, paymentCents: -2_000 })],
      2026,
      3,
      "1050",
    );
    expect(reversed.map((l) => [l.account, l.debitCents, l.creditCents])).toEqual([
      ["4000", 5_000, 0],
      ["1200", 0, 5_000],
      ["1200", 1_000, 0],
      ["4050", 0, 1_000],
      ["1200", 2_000, 0],
      ["1050", 0, 2_000],
    ]);
    const checks = checkVoucher({
      lines: reversed,
      source: { grossCents: -5_000, adjustmentCents: -1_000, paymentCents: -2_000 },
      accounts,
      otherPostedVoucher: null,
      balances: firstMonth,
    });
    expect(allPassed(checks)).toBe(true);
  });
});

describe("checkVoucher", () => {
  it("passes all five checks for a voucher built from the file", () => {
    const checks = check();
    expect(checks.map((c) => [c.id, c.passed])).toEqual([
      ["balanced", true],
      ["ties_to_file", true],
      ["receivables_tie", true],
      ["accounts_valid", true],
      ["not_posted_twice", true],
    ]);
    expect(allPassed(checks)).toBe(true);
  });

  it("fails when debits and credits differ, even by a cent", () => {
    const off = lines.map((l, i) => (i === 0 ? { ...l, debitCents: l.debitCents + 1 } : l));
    const checks = check({ lines: off });
    expect(checks.find((c) => c.id === "balanced")!.passed).toBe(false);
    expect(allPassed(checks)).toBe(false);
  });

  it("fails when the voucher no longer ties to the file", () => {
    const checks = check({ source: { ...source(groups), paymentCents: source(groups).paymentCents + 1 } });
    expect(checks.find((c) => c.id === "ties_to_file")!.passed).toBe(false);
    expect(checks.find((c) => c.id === "balanced")!.passed).toBe(true);
  });

  it("fails for accounts missing from the chart, of the wrong type, or lines without a site", () => {
    const missing = new Map(accounts);
    missing.delete("4150");
    expect(check({ accounts: missing }).find((c) => c.id === "accounts_valid")).toMatchObject({
      passed: false,
      detail: expect.stringContaining("4150"),
    });
    const wrongType = new Map(accounts).set("1050", "revenue");
    expect(check({ accounts: wrongType }).find((c) => c.id === "accounts_valid")!.passed).toBe(false);
    const noSite = buildVoucherLines([group({ siteCode: "" })], 2026, 3, "1050");
    const checks = checkVoucher({
      lines: noSite,
      source: source([group()]),
      accounts,
      otherPostedVoucher: null,
      balances: firstMonth,
    });
    expect(checks.find((c) => c.id === "accounts_valid")).toMatchObject({
      passed: false,
      detail: expect.stringContaining("no site"),
    });
    expect(noSite[0]!.memo).toBe("Patient charges Mar 2026, site none");
  });

  it("fails when another voucher already posts the period", () => {
    expect(
      check({ otherPostedVoucher: "RCM-2026-03-v1" }).find((c) => c.id === "not_posted_twice"),
    ).toMatchObject({
      passed: false,
      detail: expect.stringContaining("RCM-2026-03-v1"),
    });
  });

  it("fails an empty voucher", () => {
    const checks = checkVoucher({
      lines: [],
      source: { grossCents: 0, adjustmentCents: 0, paymentCents: 0 },
      accounts,
      otherPostedVoucher: null,
      balances: firstMonth,
    });
    expect(checks.find((c) => c.id === "balanced")!.passed).toBe(false);
  });
});

describe("receivable reclassification", () => {
  const single = [group()]; // site 00, AR 1200: +100,000 − 30,000 − 45,000 = +25,000
  const opening = new Map([[balanceKey("00", "1200"), 50_000]]);

  it("moves balances whose financial class changed and ties every account", () => {
    // 10,000 of the receivable moved to patient responsibility (1240) this month.
    const closing = new Map([
      [balanceKey("00", "1200"), 65_000],
      [balanceKey("00", "1240"), 10_000],
    ]);
    const built = buildVoucherLines(single, 2026, 3, "1050", { opening, closing });
    expect(
      built.filter((l) => l.role === "reclass").map((l) => [l.account, l.debitCents, l.creditCents]),
    ).toEqual([
      ["1200", 0, 10_000],
      ["1240", 10_000, 0],
    ]);
    const checks = checkVoucher({
      lines: built,
      source: source(single),
      accounts,
      otherPostedVoucher: null,
      balances: { opening, closing },
    });
    expect(checks.every((c) => c.passed)).toBe(true);
    expect(checks.find((c) => c.id === "receivables_tie")!.detail).toMatch(/equal the file/);
  });

  it("adds nothing when routing didn't change", () => {
    const closing = new Map([[balanceKey("00", "1200"), 75_000]]);
    const built = buildVoucherLines(single, 2026, 3, "1050", { opening, closing });
    expect(built.some((l) => l.role === "reclass")).toBe(false);
  });

  it("can't balance when the file doesn't roll forward (a missing line)", () => {
    const closing = new Map([[balanceKey("00", "1200"), 74_000]]);
    const built = buildVoucherLines(single, 2026, 3, "1050", { opening, closing });
    const checks = checkVoucher({
      lines: built,
      source: source(single),
      accounts,
      otherPostedVoucher: null,
      balances: { opening, closing },
    });
    expect(checks.find((c) => c.id === "balanced")).toMatchObject({
      passed: false,
      detail: expect.stringContaining("doesn't roll forward"),
    });
  });

  it("flags stored lines that no longer tie to the file's balances", () => {
    const closing = new Map([[balanceKey("00", "1200"), 75_000]]);
    const built = buildVoucherLines(single, 2026, 3, "1050", { opening, closing });
    const checks = checkVoucher({
      lines: built,
      source: source(single),
      accounts,
      otherPostedVoucher: null,
      balances: { opening, closing: new Map([[balanceKey("00", "1200"), 70_000]]) },
    });
    expect(checks.find((c) => c.id === "receivables_tie")).toMatchObject({
      passed: false,
      detail: expect.stringContaining("00 / 1200"),
    });
  });

  it("explains the first month", () => {
    expect(check().find((c) => c.id === "receivables_tie")!.detail).toMatch(/First imported month/);
  });
});

describe("voucherCsv", () => {
  it("writes a GL import file dated the last day of the period", () => {
    const csv = voucherCsv({ number: voucherNumber(2024, 2, 3), periodYear: 2024, periodMonth: 2 }, lines);
    const rows = parseCsv(csv, { maxRows: 100, maxColumns: 10, headerRows: 1 }).map((r) => r.cells);
    expect(rows[0]).toEqual(["Journal", "Date", "Account", "Site", "Debit", "Credit", "Memo"]);
    expect(rows[1]).toEqual([
      "RCM-2024-02-v3",
      "2024-02-29",
      "1200",
      "00",
      "1000.00",
      "",
      "Patient charges Mar 2026, site 00",
    ]);
    expect(rows[2]!.slice(4, 6)).toEqual(["", "1000.00"]);
    expect(rows).toHaveLength(lines.length + 1);
  });

  it("neutralizes spreadsheet formulas in text cells", () => {
    const csv = voucherCsv({ number: "RCM-2026-03-v1", periodYear: 2026, periodMonth: 3 }, [
      { account: "=1+1", siteCode: "@01", debitCents: 100, creditCents: 0, memo: "+memo" },
    ]);
    expect(csv).toContain("'=1+1,'@01,1.00,,'+memo");
  });
});
