import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildAllReportsWorkbook,
  buildReportWorkbook,
  sanitizeCellText,
  uniqueSheetName,
  type SheetSpec,
  type WorkbookAbout,
} from "./workbook";

const about: WorkbookAbout = {
  reportName: "Denial summary by category and CARC",
  practiceName: "Synthetic Family Medicine (synthetic)",
  filtersApplied: ["Date range: 2026-07-01 to 2026-09-26", "Payer: All payers"],
  generatedAt: new Date("2026-09-26T12:00:00Z"),
  generatedByUserId: "11111111-1111-1111-1111-111111111111",
  definitions: [{ term: "Denial rate", definition: "Distinct denied claims / distinct submitted claims." }],
  caveats: ["Paid amounts are seed-only; 835 posting is not yet built."],
};

const sheet: SheetSpec = {
  name: "Denials by category",
  columns: [
    { header: "Category", key: "category", type: "text" },
    { header: "Count", key: "count", type: "number" },
    { header: "Denied ($)", key: "sumCents", type: "currency" },
    { header: "Overturn rate", key: "rate", type: "percent" },
    { header: "Notice date", key: "date", type: "date" },
  ],
  rows: [
    { category: "Coding", count: 3, sumCents: 150000, rate: 0.25, date: "2026-08-01" },
    { category: "=cmd|'/c calc'!A0", count: 1, sumCents: 500, rate: 0.5, date: "2026-08-02" },
  ],
  totals: { category: "Total", count: 4, sumCents: 150500, rate: null, date: null },
};

describe("sanitizeCellText", () => {
  it("prefixes text starting with = + - @ with an apostrophe", () => {
    expect(sanitizeCellText("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(sanitizeCellText("+1")).toBe("'+1");
    expect(sanitizeCellText("-1")).toBe("'-1");
    expect(sanitizeCellText("@cmd")).toBe("'@cmd");
    expect(sanitizeCellText("Coding")).toBe("Coding");
  });
});

describe("buildReportWorkbook", () => {
  it("produces a workbook with an About sheet and a data sheet, readable back by exceljs", async () => {
    const buffer = await buildReportWorkbook(about, [sheet]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

    const sheetNames = workbook.worksheets.map((w) => w.name);
    expect(sheetNames).toEqual(["About", "Denials by category"]);

    const aboutSheet = workbook.getWorksheet("About")!;
    const aboutText = aboutSheet
      .getSheetValues()
      .flat()
      .filter((v): v is string => typeof v === "string")
      .join(" ");
    expect(aboutText).toContain("Synthetic Family Medicine");
    expect(aboutText).toContain(about.generatedByUserId);
    expect(aboutText).toContain("Paid amounts are seed-only");

    const dataSheet = workbook.getWorksheet("Denials by category")!;
    const headerRow = dataSheet.getRow(1);
    expect(headerRow.getCell(1).value).toBe("Category");
    expect(headerRow.font?.bold).toBe(true);
    // Frozen header row.
    expect(dataSheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    // Autofilter over the header.
    expect(dataSheet.autoFilter).toBeTruthy();

    // Row 2: normal data — currency stored as a real number in dollars, with a currency format.
    const row2 = dataSheet.getRow(2);
    expect(row2.getCell(2).value).toBe(3);
    expect(row2.getCell(3).value).toBe(1500); // 150000 cents -> 1500 dollars
    expect(row2.getCell(3).numFmt).toContain("$");
    expect(row2.getCell(4).value).toBe(0.25);
    expect(row2.getCell(4).numFmt).toContain("%");
    expect(row2.getCell(5).value).toBeInstanceOf(Date);

    // Row 3: formula-injection text is sanitized (apostrophe-prefixed, not a live formula).
    const row3 = dataSheet.getRow(3);
    expect(row3.getCell(1).value).toBe("'=cmd|'/c calc'!A0");
    expect(typeof row3.getCell(1).value).toBe("string");

    // Totals row is present and bold, with a blank cell where no total applies.
    const totalsRow = dataSheet.getRow(4);
    expect(totalsRow.getCell(1).value).toBe("Total");
    expect(totalsRow.getCell(3).value).toBe(1505);
    expect(totalsRow.font?.bold).toBe(true);
    expect(totalsRow.getCell(4).value == null).toBe(true);

    // No merged cells in the data area (About sheet's prose caveats are the one allowed exception).
    expect(dataSheet.model.merges ?? []).toEqual([]);
  });

  it("truncates a sheet name to Excel's 31-character limit", async () => {
    const longSheet: SheetSpec = { ...sheet, name: "A".repeat(50) };
    const buffer = await buildReportWorkbook(about, [longSheet]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(workbook.worksheets[1]!.name.length).toBeLessThanOrEqual(31);
  });

  it("writes an emptyMessage instead of a blank data area when there are no rows", async () => {
    const emptySheet: SheetSpec = {
      ...sheet,
      rows: [],
      totals: undefined,
      emptyMessage: "No decided appeals in this period",
    };
    const buffer = await buildReportWorkbook(about, [emptySheet]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const dataSheet = workbook.getWorksheet("Denials by category")!;
    expect(dataSheet.getCell(2, 1).value).toBe("No decided appeals in this period");
  });
});

describe("uniqueSheetName", () => {
  it("strips characters Excel forbids in a sheet name", () => {
    const used = new Set<string>();
    expect(uniqueSheetName("appeal-outcomes: Appeal outcomes", used)).not.toMatch(/[*?:\\/[\]]/);
  });

  it("resolves a collision after truncation to two distinct names", () => {
    const used = new Set<string>();
    // Both names share the same first 31 characters after their differing suffix is cut off.
    const a = uniqueSheetName("Appeal outcomes by payer of the practice, long", used);
    const b = uniqueSheetName("Appeal outcomes by category of the practice, long", used);
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(31);
    expect(b.length).toBeLessThanOrEqual(31);
  });

  it("never produces the same name twice across many collisions", () => {
    const used = new Set<string>();
    const names = Array.from({ length: 15 }, (_, i) => uniqueSheetName(`Report ${i}`.padEnd(40, "x"), used));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("buildAllReportsWorkbook", () => {
  it("builds a workbook with a unique sheet per report plus About", async () => {
    const sheetA: SheetSpec = { ...sheet, name: "appeal-outcomes - Appeal outcomes by payer" };
    const sheetB: SheetSpec = { ...sheet, name: "appeal-outcomes - Appeal outcomes by category" };
    const buffer = await buildAllReportsWorkbook(about, [sheetA, sheetB]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const names = workbook.worksheets.map((w) => w.name);
    expect(names[0]).toBe("About");
    expect(new Set(names).size).toBe(names.length);
  });
});
