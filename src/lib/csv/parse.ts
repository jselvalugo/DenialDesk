/**
 * Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF/LF, BOM). No dependency, no
 * eval, bounded by the caller's size limit. Throws CsvError with a row number, never cell text
 * (cells may hold PHI and error messages can reach logs).
 */
export class CsvError extends Error {
  constructor(
    message: string,
    readonly row: number,
  ) {
    super(message);
    this.name = "CsvError";
  }
}

export function parseCsv(text: string, options: { maxRows: number }): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    field = "";
    // Skip fully blank lines.
    if (!(row.length === 1 && row[0] === "")) {
      rows.push(row);
      if (rows.length > options.maxRows) {
        throw new CsvError(
          `The file has more than ${options.maxRows.toLocaleString("en-US")} rows.`,
          rows.length,
        );
      }
    }
    row = [];
  };

  while (i < input.length) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      if (field !== "") throw new CsvError("A quote appears inside an unquoted field.", rows.length + 1);
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      endRow();
    } else {
      field += ch;
    }
    i++;
  }
  if (quoted) throw new CsvError("A quoted field is never closed.", rows.length + 1);
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** Neutralizes spreadsheet formulas in exported cells (CSV injection, OWASP). */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
