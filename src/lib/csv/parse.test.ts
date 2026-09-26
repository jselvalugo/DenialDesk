import { describe, expect, it } from "vitest";
import { csvCell, CsvError, parseCsv } from "./parse";

const limits = { maxRows: 10, maxColumns: 20 };

describe("parseCsv", () => {
  it("parses quoted fields, escaped quotes, CRLF, and a BOM, with physical line numbers", () => {
    const text = '﻿a,b,c\r\n"x, y","say ""hi""",3\n\n"multi\nline",,end\n,,,\n"last",1,2';
    expect(parseCsv(text, limits)).toEqual([
      { line: 1, cells: ["a", "b", "c"] },
      { line: 2, cells: ["x, y", 'say "hi"', "3"] },
      { line: 4, cells: ["multi\nline", "", "end"] },
      { line: 7, cells: ["last", "1", "2"] },
    ]);
  });

  it("keeps a trailing empty field and an empty quoted field", () => {
    expect(parseCsv('a,b,\n"",x', limits)).toEqual([
      { line: 1, cells: ["a", "b", ""] },
      { line: 2, cells: ["", "x"] },
    ]);
  });

  it("rejects malformed quoting without echoing cell text", () => {
    expect(() => parseCsv('a,"open\n', limits)).toThrow(/never closed/);
    expect(() => parseCsv('"ab"cd,e', limits)).toThrow(/follows a closing quote/);
    try {
      parseCsv('ok\nSECRET"NAME,b', limits);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("SECRET");
      expect((error as CsvError).row).toBe(2);
    }
  });

  it("enforces row and column limits", () => {
    expect(() => parseCsv("a\nb\nc\nd", { maxRows: 3, maxColumns: 5 })).toThrow(/more than 3 rows/);
    expect(parseCsv("a\nb\nc", { maxRows: 3, maxColumns: 5 })).toHaveLength(3);
    expect(() => parseCsv(",".repeat(10), { maxRows: 3, maxColumns: 5 })).toThrow(/more than 5 columns/);
  });
});

describe("csvCell", () => {
  it("neutralizes formulas and quotes when needed", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("  =HYPERLINK(1)")).toBe("'  =HYPERLINK(1)");
    expect(csvCell("＝1+1")).toBe("'＝1+1");
    expect(csvCell("\t=1")).toBe("'\t=1");
    expect(csvCell("a = b")).toBe("a = b");
  });
});
