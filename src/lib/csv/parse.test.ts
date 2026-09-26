import { describe, expect, it } from "vitest";
import { csvCell, CsvError, parseCsv } from "./parse";

describe("parseCsv", () => {
  it("parses quoted fields, escaped quotes, CRLF, and a BOM", () => {
    const text = '﻿a,b,c\r\n"x, y","say ""hi""",3\n\n"multi\nline",,end';
    expect(parseCsv(text, { maxRows: 10 })).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "3"],
      ["multi\nline", "", "end"],
    ]);
  });

  it("keeps a trailing empty field", () => {
    expect(parseCsv("a,b,\n", { maxRows: 5 })).toEqual([["a", "b", ""]]);
  });

  it("rejects unterminated quotes and stray quotes without echoing cell text", () => {
    expect(() => parseCsv('a,"open\n', { maxRows: 5 })).toThrow(CsvError);
    try {
      parseCsv('SECRET"NAME,b', { maxRows: 5 });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("SECRET");
      expect((error as CsvError).row).toBe(1);
    }
  });

  it("enforces the row limit", () => {
    expect(() => parseCsv("a\nb\nc\nd", { maxRows: 3 })).toThrow(/more than 3 rows/);
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
  });
});
