import { describe, expect, it } from "vitest";
import { MONTHLY_FILE_HEADER, parseMoney, parseMonthlyFile, parseServiceDate } from "./monthly-file";

const header = MONTHLY_FILE_HEADER.join(",");
const row = (overrides: Partial<Record<string, string>> = {}) => {
  const values: Record<string, string> = {
    Patient: "Synthetic, Ana",
    "Account #": "SYN-000123",
    "Svc Date": "03/14/2026",
    CPT: "99213",
    Description: "Office visit",
    Facility: "Main clinic",
    Payer: "Gulf Coast Mutual",
    "Payer Class": "COM",
    Status: "PAID",
    "Billed Charge": "$1,234.50",
    "Total Payment": "(10.00)",
    Balance: "1224.5",
    ...overrides,
  };
  return MONTHLY_FILE_HEADER.map((h) => `"${values[h] ?? ""}"`).join(",");
};

describe("parseMoney", () => {
  it.each([
    ["$1,234.56", 123_456],
    ["1234.5", 123_450],
    ["(12.00)", -1_200],
    ["-7", -700],
    ["", 0],
    ["0.07", 7],
  ])("%s → %d", (raw, cents) => expect(parseMoney(raw)).toBe(cents));

  it.each(["12.345", "abc", "1e5", "$", "--5"])("rejects %s", (raw) => expect(parseMoney(raw)).toBeNull());
});

describe("parseServiceDate", () => {
  it("accepts US and ISO dates and rejects impossible ones", () => {
    expect(parseServiceDate("3/4/2026")).toBe("2026-03-04");
    expect(parseServiceDate("2026-02-28")).toBe("2026-02-28");
    expect(parseServiceDate("02/30/2026")).toBeNull();
    expect(parseServiceDate("2026/02/01")).toBeNull();
  });
});

describe("parseMonthlyFile", () => {
  it("maps columns by header name, in any order and case", () => {
    const text = `${header}\n${row()}`;
    const result = parseMonthlyFile(text, { syntheticOnly: true });
    expect(result.ok && result.lines[0]).toMatchObject({
      rowNumber: 2,
      accountNumber: "SYN-000123",
      serviceDate: "2026-03-14",
      billedCents: 123_450,
      paymentCents: -1_000,
      balanceCents: 122_450,
    });
    const reordered =
      "balance,TOTAL PAYMENT,billed charge,payer class,cpt,svc date,account #,patient\n1,2,3,COM,99213,01/02/2026,SYN-1,Syn";
    expect(parseMonthlyFile(reordered, { syntheticOnly: true }).ok).toBe(true);
  });

  it("names missing required columns", () => {
    const result = parseMonthlyFile("Patient,CPT\nx,99213", { syntheticOnly: false });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems[0]!.message).toMatch(/Account #.*Svc Date.*Payer Class/);
  });

  it("rejects the whole file when any row is invalid, without echoing values", () => {
    const text = [
      header,
      row(),
      row({ "Billed Charge": "12,34x", Patient: "" }),
      row({ "Svc Date": "13/01/2026" }),
    ].join("\n");
    const result = parseMonthlyFile(text, { syntheticOnly: true });
    expect(result.ok).toBe(false);
    const problems = !result.ok ? result.problems : [];
    expect(problems.map((p) => p.row)).toEqual([3, 3, 4]);
    expect(JSON.stringify(problems)).not.toContain("12,34x");
  });

  it("accepts only synthetic account numbers outside production", () => {
    const text = `${header}\n${row({ "Account #": "4471902" })}`;
    const synthetic = parseMonthlyFile(text, { syntheticOnly: true });
    expect(!synthetic.ok && synthetic.problems[0]!.message).toMatch(/synthetic files only/);
    expect(parseMonthlyFile(text, { syntheticOnly: false }).ok).toBe(true);
  });

  it("rejects files with no data rows", () => {
    expect(parseMonthlyFile(header, { syntheticOnly: true }).ok).toBe(false);
  });
});
