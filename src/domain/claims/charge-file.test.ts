import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/messages/en";
import { es } from "@/i18n/messages/es";
import { pt } from "@/i18n/messages/pt";
import { createTranslator } from "@/i18n/translate";
import {
  CHARGE_FILE_HEADER,
  checkChargeUpload,
  MAX_CHARGE_CENTS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  MAX_LINES_PER_CLAIM,
  MAX_REPORT_PROBLEMS,
  parseChargeFile,
  PROBLEM_MESSAGE_KEYS,
  problemMessage,
  splitAsGiven,
  type ChargeProblemCode,
} from "./charge-file";

const TODAY = "2026-09-29";
const HEADER = CHARGE_FILE_HEADER.join(",");
const open = { syntheticOnly: false, today: TODAY };
const synthetic = { syntheticOnly: true, today: TODAY };

/** One valid line; overrides replace columns by header name. */
function line(overrides: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    "Claim number": "SYN-T-1",
    MRN: "SYN-100",
    Payer: "Gulf Coast Mutual (synthetic)",
    "Service date": "2026-09-14",
    "Diagnosis codes": "E11.9",
    "Procedure code": "99213",
    Modifiers: "",
    Units: "1",
    Charge: "145.00",
    "Provider NPI": "",
    Location: "",
    ...overrides,
  };
  return CHARGE_FILE_HEADER.map((h) => {
    const value = base[h] ?? "";
    return /[",]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(",");
}

const file = (...lines: string[]) => [HEADER, ...lines].join("\n");

function codesOf(result: ReturnType<typeof parseChargeFile>): ChargeProblemCode[] {
  return result.ok ? [] : result.problems.map((p) => p.code);
}

describe("charge file: the synthetic sample", () => {
  const sample = readFileSync(
    new URL("../../../test/fixtures/synthetic/charge-import-sample.csv", import.meta.url),
    "utf8",
  );

  it("parses into claims of lines, with dates, money, and codes exactly as written", () => {
    const result = parseChargeFile(sample, synthetic);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rowCount).toBe(4);
    expect(result.claims.map((c) => c.claimNumber)).toEqual(["SYN-CHG-0001", "SYN-CHG-0002", "SYN-CHG-0003"]);
    const [first, second, third] = result.claims;
    expect(
      first!.lines.map((l) => [l.rowNumber, l.procedureCode, l.modifiers, l.units, l.chargeCents]),
    ).toEqual([
      [2, "99214", ["25"], 1, 21000],
      [3, "36415", [], 1, 1800],
    ]);
    expect(first!.diagnosisCodes).toEqual(["E11.9", "I10"]);
    expect(second!.serviceDate).toBe("2026-09-10"); // M/D/YYYY in the file
    expect(second!.lines[0]!.chargeCents).toBe(26000); // "$260.00"
    expect(third!.lines[0]!.chargeCents).toBe(114550); // "1,145.50"
    expect(third!.firstRow).toBe(5);
  });

  it("carries only synthetic markers (R-15.1)", () => {
    for (const row of sample.split("\n").slice(1).filter(Boolean)) {
      expect(row.startsWith("SYN-CHG-")).toBe(true);
      expect(row).toContain("SYN-9010");
    }
  });
});

describe("charge file: header", () => {
  it("matches headers ignoring case and punctuation, and ignores columns it doesn't read", () => {
    const text = [
      "claim NO.,Patient Name,Medical Record Number,PAYER,Date of Service,Diagnosis,CPT,Units,Charge Amount,Member ID",
      "SYN-A-1,Jane Synthetic,SYN-100,Gulf Coast Mutual (synthetic),2026-09-14,E11.9,99213,1,145.00,SYN-MEMBER-9",
    ].join("\n");
    const result = parseChargeFile(text, synthetic);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Unlisted columns (a name, a member ID) are never read into the result.
    expect(JSON.stringify(result.claims)).not.toContain("Jane");
    expect(JSON.stringify(result.claims)).not.toContain("MEMBER");
  });

  it("names missing required columns, and refuses ambiguous ones, with no cell text", () => {
    const missing = parseChargeFile("Claim number,MRN\nSYN-A-1,SYN-1", open);
    expect(missing).toMatchObject({ ok: false, problems: [{ row: 1, code: "missing_columns" }] });
    expect(JSON.stringify(missing)).toContain("Payer");
    expect(JSON.stringify(missing)).not.toContain("SYN-A-1");
    const ambiguous = parseChargeFile(`${HEADER},CPT\n${line()},99213`, open);
    expect(codesOf(ambiguous)).toEqual(["ambiguous_columns"]);
  });

  it("needs at least one data row", () => {
    expect(codesOf(parseChargeFile(HEADER, open))).toEqual(["no_data_rows"]);
    expect(codesOf(parseChargeFile("", open))).toEqual(["no_data_rows"]);
  });

  it("reports malformed CSV by line, with a code", () => {
    expect(codesOf(parseChargeFile(`${HEADER}\n"unclosed`, open))).toEqual(["csv_unclosed_quote"]);
    expect(codesOf(parseChargeFile(`${HEADER}\nab"c,d`, open))).toEqual(["csv_quote_in_field"]);
  });

  it("caps rows and columns", () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) =>
      line({ "Claim number": `SYN-R-${i}` }),
    );
    expect(codesOf(parseChargeFile(file(...rows), open))).toEqual(["csv_too_many_rows"]);
    const wide = `${HEADER},${Array.from({ length: 100 }, (_, i) => `x${i}`).join(",")}\n${line()}`;
    expect(codesOf(parseChargeFile(wide, open))).toEqual(["csv_too_many_columns"]);
  });

  it("holds the header contract: the template lists every column in order", () => {
    expect(CHARGE_FILE_HEADER).toEqual([
      "Claim number",
      "MRN",
      "Payer",
      "Service date",
      "Diagnosis codes",
      "Procedure code",
      "Modifiers",
      "Units",
      "Charge",
      "Provider NPI",
      "Location",
    ]);
  });
});

describe("charge file: codes are stored exactly as given (R-3.10.1, CLAUDE.md #8)", () => {
  it("keeps code text, order, duplicates, and decimal points untouched", () => {
    const result = parseChargeFile(
      file(line({ "Diagnosis codes": "I10; E11.9,Z00.00  E11.9", Modifiers: "59 25" })),
      open,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims[0]!.diagnosisCodes).toEqual(["I10", "E11.9", "Z00.00", "E11.9"]);
    expect(result.claims[0]!.lines[0]!.modifiers).toEqual(["59", "25"]);
  });

  it("refuses lower-case or malformed codes instead of fixing them", () => {
    for (const [column, value, code] of [
      ["Diagnosis codes", "e11.9", "diagnosis_format"],
      ["Diagnosis codes", "E119999999", "diagnosis_format"],
      ["Procedure code", "9921", "procedure_code_format"], // four characters: not padded
      ["Procedure code", "99213x", "procedure_code_format"],
      ["Procedure code", "9a213", "procedure_code_format"],
      ["Modifiers", "ab", "modifier_format"],
      ["Modifiers", "2", "modifier_format"],
    ] as const) {
      const result = parseChargeFile(file(line({ [column]: value })), open);
      expect(codesOf(result), `${column}=${value}`).toEqual([code]);
      // The message never repeats the value.
      expect(JSON.stringify(result)).not.toContain(`"${value}"`);
    }
  });

  it("limits diagnoses and modifiers by count", () => {
    const thirteen = Array.from({ length: 13 }, (_, i) => `A0${i % 10}`).join(" ");
    expect(codesOf(parseChargeFile(file(line({ "Diagnosis codes": thirteen })), open))).toEqual([
      "diagnosis_too_many",
    ]);
    expect(codesOf(parseChargeFile(file(line({ Modifiers: "25 59 76 77 XS" })), open))).toEqual([
      "modifier_too_many",
    ]);
    expect(parseChargeFile(file(line({ Modifiers: "25 59 76 77" })), open).ok).toBe(true);
  });

  it("splits lists on spaces, commas, and semicolons without changing the pieces", () => {
    expect(splitAsGiven(" a,b;c  d ")).toEqual(["a", "b", "c", "d"]);
    expect(splitAsGiven("")).toEqual([]);
  });
});

describe("charge file: per-row rules and their codes", () => {
  const cases: [string, Record<string, string>, ChargeProblemCode][] = [
    ["blank claim number", { "Claim number": "" }, "claim_number_blank"],
    ["claim number with a space", { "Claim number": "SYN-1 2" }, "claim_number_format"],
    ["claim number too long", { "Claim number": `SYN-${"1".repeat(30)}` }, "claim_number_format"],
    ["blank MRN", { MRN: "" }, "mrn_blank"],
    ["blank payer", { Payer: "" }, "payer_blank"],
    ["blank service date", { "Service date": "" }, "service_date_invalid"],
    ["impossible date", { "Service date": "2026-02-30" }, "service_date_invalid"],
    ["two-digit year", { "Service date": "9/10/26" }, "service_date_invalid"],
    ["blank diagnosis", { "Diagnosis codes": "" }, "diagnosis_blank"],
    ["blank procedure", { "Procedure code": "" }, "procedure_code_format"],
    ["zero units", { Units: "0" }, "units_invalid"],
    ["1000 units", { Units: "1000" }, "units_invalid"],
    ["fractional units", { Units: "1.5" }, "units_invalid"],
    ["blank units", { Units: "" }, "units_invalid"],
    ["blank charge", { Charge: "" }, "charge_invalid"],
    ["three decimals", { Charge: "12.345" }, "charge_invalid"],
    ["scattered separators", { Charge: "1,2,3" }, "charge_invalid"],
    ["words", { Charge: "free" }, "charge_invalid"],
    ["zero charge", { Charge: "0.00" }, "charge_range"],
    ["negative charge", { Charge: "-5.00" }, "charge_range"],
    ["parenthesised charge", { Charge: "(5.00)" }, "charge_range"],
    ["over the line limit", { Charge: "100,000.00" }, "charge_range"],
    ["short NPI", { "Provider NPI": "12345" }, "provider_npi_format"],
    ["lettered NPI", { "Provider NPI": "12345abcde" }, "provider_npi_format"],
    ["cell over 200 characters", { Location: "x".repeat(201) }, "too_long"],
  ];
  it.each(cases)("%s", (_, override, code) => {
    const result = parseChargeFile(file(line(override)), open);
    expect(codesOf(result)).toContain(code);
    if (!result.ok) expect(result.problems.every((p) => p.row === 2)).toBe(true);
  });

  it("accepts the edges: $0.01, $99,999.99, 1 and 999 units, ten-digit NPI", () => {
    for (const [charge, cents] of [
      ["0.01", 1],
      ["99,999.99", MAX_CHARGE_CENTS],
      ["$1,250.5", 125050],
      ["7", 700],
    ] as const) {
      const result = parseChargeFile(
        file(line({ Charge: charge, Units: "999", "Provider NPI": "1234567890" })),
        open,
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.claims[0]!.lines[0]!.chargeCents).toBe(cents);
    }
    const one = parseChargeFile(file(line({ Units: "1" })), open);
    expect(one.ok && one.claims[0]!.lines[0]!.units).toBe(1);
  });

  it("names the column, never the value", () => {
    const result = parseChargeFile(file(line({ Charge: "SECRET-AMOUNT" })), open);
    expect(result).toMatchObject({
      ok: false,
      problems: [{ row: 2, code: "charge_invalid", column: "Charge" }],
    });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("reports the physical line, counting blank lines and quoted newlines", () => {
    const text = `${HEADER}\n\n${line()}\n${line({ "Claim number": "SYN-T-2", Units: "0", Location: '"a\nb"' })}`;
    const result = parseChargeFile(text, open);
    expect(result).toMatchObject({ ok: false, problems: [{ row: 4, code: "units_invalid" }] });
  });
});

describe("charge file: dates of service", () => {
  it.each([
    ["2026-09-28", true],
    [TODAY, true], // today is fine
    ["2026-09-30", false], // tomorrow
    ["2000-01-01", true],
    ["1999-12-31", false],
  ])("%s accepted=%s", (date, accepted) => {
    const result = parseChargeFile(file(line({ "Service date": date })), open);
    expect(result.ok).toBe(accepted);
    if (!accepted && !result.ok) {
      expect(result.problems[0]!.code).toBe(date > TODAY ? "service_date_future" : "service_date_too_old");
    }
  });

  it("accepts YYYY-MM-DD and M/D/YYYY, and reads the same date from both", () => {
    const a = parseChargeFile(file(line({ "Service date": "2026-09-05" })), open);
    const b = parseChargeFile(file(line({ "Service date": "9/5/2026" })), open);
    expect(a.ok && b.ok && a.claims[0]!.serviceDate === b.claims[0]!.serviceDate).toBe(true);
  });
});

describe("charge file: claims of several lines", () => {
  it("groups the lines of a claim and keeps them in file order", () => {
    const result = parseChargeFile(
      file(
        line({ "Procedure code": "99213" }),
        line({ "Procedure code": "36415", Modifiers: "59" }),
        line({ "Claim number": "SYN-T-2", MRN: "SYN-200" }),
      ),
      open,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims).toHaveLength(2);
    expect(result.claims[0]!.lines.map((l) => [l.rowNumber, l.procedureCode])).toEqual([
      [2, "99213"],
      [3, "36415"],
    ]);
    expect(result.claims[1]!.firstRow).toBe(4);
  });

  it("requires claim-level columns to match on every line, naming the column", () => {
    for (const [column, value] of [
      ["MRN", "SYN-999"],
      ["Payer", "Sunward HMO (synthetic)"],
      ["Service date", "2026-09-15"],
      ["Diagnosis codes", "I10"],
      ["Provider NPI", "1234567890"],
      ["Location", "Somewhere"],
    ] as const) {
      const result = parseChargeFile(
        file(line(), line({ [column]: value, "Procedure code": "36415" })),
        open,
      );
      expect(result, column).toMatchObject({
        ok: false,
        problems: [{ row: 3, code: "claim_fields_differ", column }],
      });
    }
  });

  it("treats the payer text case-insensitively when comparing lines", () => {
    const result = parseChargeFile(
      file(line(), line({ Payer: "GULF COAST MUTUAL (SYNTHETIC)", "Procedure code": "36415" })),
      open,
    );
    expect(result.ok).toBe(true);
  });

  it("limits a claim to 50 lines, reporting once", () => {
    const lines = Array.from({ length: MAX_LINES_PER_CLAIM + 3 }, (_, i) =>
      line({ "Procedure code": `99${200 + i}` }),
    );
    const result = parseChargeFile(file(...lines), open);
    expect(codesOf(result)).toEqual(["too_many_lines"]);
    expect(parseChargeFile(file(...lines.slice(0, MAX_LINES_PER_CLAIM)), open).ok).toBe(true);
  });

  it("refuses a line that repeats an earlier line of the claim, instead of merging it (a file pasted twice)", () => {
    const result = parseChargeFile(
      file(
        line({ "Procedure code": "99213", Modifiers: "25" }),
        line({ "Procedure code": "36415" }),
        line({ "Procedure code": "99213", Modifiers: "25" }),
      ),
      open,
    );
    expect(result).toMatchObject({
      ok: false,
      problems: [{ row: 4, code: "duplicate_line", column: "Procedure code" }],
    });
  });

  it("compares a line by procedure code and modifiers, in any order, not by units or charge", () => {
    const differentModifier = parseChargeFile(
      file(line({ Modifiers: "25" }), line({ Modifiers: "59" }), line({ Modifiers: "" })),
      open,
    );
    expect(differentModifier.ok).toBe(true);
    const reordered = parseChargeFile(
      file(line({ Modifiers: "59 25" }), line({ Modifiers: "25 59", Units: "2", Charge: "999.00" })),
      open,
    );
    expect(codesOf(reordered)).toEqual(["duplicate_line"]);
  });

  it("refuses a claim number that comes back after other claims, naming the row once", () => {
    const result = parseChargeFile(
      file(
        line({ "Procedure code": "99213" }),
        line({ "Claim number": "SYN-T-2", MRN: "SYN-200" }),
        line({ "Procedure code": "36415" }),
        line({ "Procedure code": "93000" }),
      ),
      open,
    );
    expect(result).toMatchObject({
      ok: false,
      total: 1,
      problems: [{ row: 4, code: "claim_rows_not_contiguous", column: "Claim number" }],
    });
  });

  it("doesn't call a claim non-contiguous because a blank or invalid claim-number row sits inside it", () => {
    const result = parseChargeFile(
      file(
        line({ "Procedure code": "99213" }),
        line({ "Claim number": "SYN BAD", "Procedure code": "36415" }),
        line({ "Procedure code": "93000" }),
      ),
      open,
    );
    expect(result).toMatchObject({
      ok: false,
      total: 1,
      problems: [{ row: 3, code: "claim_number_format" }],
    });
    const blank = parseChargeFile(
      file(
        line({ "Procedure code": "99213" }),
        line({ "Claim number": "", "Procedure code": "36415" }),
        line({ "Procedure code": "93000" }),
      ),
      open,
    );
    expect(codesOf(blank)).toEqual(["claim_number_blank"]);
  });

  it("refuses the same file body pasted twice: nothing is merged or doubled", () => {
    const body = [
      line({ "Claim number": "SYN-T-1", "Procedure code": "99213" }),
      line({ "Claim number": "SYN-T-1", "Procedure code": "36415" }),
      line({ "Claim number": "SYN-T-2", MRN: "SYN-200", "Procedure code": "99396" }),
    ];
    const result = parseChargeFile(file(...body, ...body), open);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(new Set(result.problems.map((p) => p.code))).toEqual(
      new Set(["claim_rows_not_contiguous", "duplicate_line"]),
    );
    // Every repeated line is named: rows 5 and 6 are the second copy of claim 1, row 7 of claim 2.
    expect(result.problems.filter((p) => p.code === "duplicate_line").map((p) => p.row)).toEqual([5, 6, 7]);
  });

  it("reports a bad claim number once, not once per line", () => {
    const bad = "SYN 1";
    const result = parseChargeFile(
      file(line({ "Claim number": bad }), line({ "Claim number": bad }), line({ "Claim number": bad })),
      open,
    );
    expect(codesOf(result).filter((c) => c === "claim_number_format")).toHaveLength(1);
  });
});

describe("charge file: synthetic-only guard", () => {
  it("requires SYN- claim numbers and SYN MRNs where only synthetic data is allowed", () => {
    const result = parseChargeFile(file(line({ "Claim number": "CHG-1", MRN: "MRN-100" })), synthetic);
    expect(codesOf(result).sort()).toEqual(["claim_number_not_synthetic", "mrn_not_synthetic"]);
    expect(JSON.stringify(result)).not.toContain("CHG-1");
    expect(JSON.stringify(result)).not.toContain("MRN-100");
  });

  it("checks the prefix, case-sensitively for claim numbers and like the patient form for MRNs", () => {
    expect(codesOf(parseChargeFile(file(line({ "Claim number": "syn-1" })), synthetic))).toEqual([
      "claim_number_not_synthetic",
    ]);
    expect(codesOf(parseChargeFile(file(line({ "Claim number": "XSYN-1" })), synthetic))).toEqual([
      "claim_number_not_synthetic",
    ]);
    expect(parseChargeFile(file(line({ MRN: "syn-100" })), synthetic).ok).toBe(true);
    expect(parseChargeFile(file(line()), synthetic).ok).toBe(true);
  });

  it("does not apply outside synthetic-only environments", () => {
    expect(parseChargeFile(file(line({ "Claim number": "CHG-1", MRN: "MRN-100" })), open).ok).toBe(true);
  });

  it("reports a non-synthetic claim number once per claim", () => {
    const rows = [line({ "Claim number": "CHG-1" }), line({ "Claim number": "CHG-1" })];
    expect(codesOf(parseChargeFile(file(...rows), synthetic))).toEqual(["claim_number_not_synthetic"]);
  });
});

describe("charge file: limits on what is reported", () => {
  it("returns at most the report limit but counts every problem", () => {
    const rows = Array.from({ length: MAX_REPORT_PROBLEMS + 200 }, (_, i) =>
      line({ "Claim number": `SYN-B-${i}`, Units: "0" }),
    );
    const result = parseChargeFile(file(...rows), open);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toHaveLength(MAX_REPORT_PROBLEMS);
    expect(result.total).toBe(MAX_REPORT_PROBLEMS + 200);
  });
});

describe("charge file: encoding of the file itself", () => {
  it("reads a UTF-8 byte-order mark and CRLF line endings, reporting the physical line", () => {
    const text = `\uFEFF${[HEADER, line(), line({ "Claim number": "SYN-T-2", Units: "0" })].join("\r\n")}\r\n`;
    const result = parseChargeFile(text, open);
    expect(result).toMatchObject({ ok: false, problems: [{ row: 3, code: "units_invalid" }] });
    const good = parseChargeFile(`\uFEFF${[HEADER, line()].join("\r\n")}\r\n`, open);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.claims[0]!.claimNumber).toBe("SYN-T-1");
  });
});

describe("failed parses carry the data-row count (for the audit event)", () => {
  it("counts rows whether the problem is in a row, the header, or nowhere but the count", () => {
    const rows = [line(), line({ "Claim number": "SYN-T-2", Units: "0" })];
    expect(parseChargeFile(file(...rows), open)).toMatchObject({ ok: false, rowCount: 2 });
    expect(parseChargeFile("Claim number,MRN\nSYN-A-1,SYN-1\nSYN-A-2,SYN-2", open)).toMatchObject({
      ok: false,
      rowCount: 2,
    });
    expect(parseChargeFile(HEADER, open)).toMatchObject({ ok: false, rowCount: 0 });
  });
});

describe("upload checks", () => {
  const ok = { name: "charges.csv", size: 1000, attestedSynthetic: true, syntheticOnly: true };
  it("passes a small CSV", () => expect(checkChargeUpload(ok)).toBeNull());
  it("refuses an empty file, another extension, an oversize file, and a missing attestation", () => {
    expect(checkChargeUpload({ ...ok, size: 0 })).toBe("chooseFile");
    expect(checkChargeUpload({ ...ok, name: "charges.xlsx" })).toBe("notCsv");
    expect(checkChargeUpload({ ...ok, name: "charges.csv.exe" })).toBe("notCsv");
    expect(checkChargeUpload({ ...ok, size: MAX_IMPORT_BYTES + 1 })).toBe("tooLarge");
    expect(checkChargeUpload({ ...ok, size: MAX_IMPORT_BYTES })).toBeNull();
    expect(checkChargeUpload({ ...ok, attestedSynthetic: false })).toBe("confirmSynthetic");
    expect(checkChargeUpload({ ...ok, attestedSynthetic: false, syntheticOnly: false })).toBeNull();
  });
});

describe("problem messages", () => {
  const codes = Object.keys(PROBLEM_MESSAGE_KEYS) as ChargeProblemCode[];
  const languages = { en, es, pt } as const;

  it.each(Object.keys(languages) as (keyof typeof languages)[])(
    "every code has a complete sentence in %s, with no unresolved placeholder and no cell value",
    (locale) => {
      const t = createTranslator(languages[locale].claims, locale);
      for (const code of codes) {
        const message = problemMessage(
          { row: 7, code, column: "Charge", params: { max: 12, prefix: "SYN-", columns: "MRN, Payer" } },
          t,
        );
        expect(message, `${locale}:${code}`).not.toMatch(/[{}]/);
        expect(message.length).toBeGreaterThan(10);
      }
    },
  );
});
