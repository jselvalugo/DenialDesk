/**
 * Minimal, strict RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF/LF, BOM). No dependency,
 * no eval, bounded by row and column limits. Rows carry their physical line number so errors match
 * what a user sees in a spreadsheet or editor. Throws CsvError with a line number, never cell text
 * (cells may hold PHI and error messages can reach logs). Rows whose cells are all empty (blank
 * lines, trailing ",,,," rows from spreadsheet exports) are skipped.
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

export interface CsvRow {
  line: number;
  cells: string[];
}

export function parseCsv(
  text: string,
  options: { maxRows: number; maxColumns: number; headerRows?: number },
): CsvRow[] {
  const rowLimit = options.maxRows + (options.headerRows ?? 0);
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;
  let line = 1;
  let rowLine = 1;

  const pushField = () => {
    cells.push(field);
    field = "";
    closedQuote = false;
    if (cells.length > options.maxColumns) {
      throw new CsvError(`A row has more than ${options.maxColumns} columns.`, rowLine);
    }
  };
  const endRow = () => {
    pushField();
    if (cells.some((cell) => cell !== "")) {
      rows.push({ line: rowLine, cells });
      if (rows.length > rowLimit) {
        throw new CsvError(
          `The file has more than ${options.maxRows.toLocaleString("en-US")} ${options.headerRows ? "data rows" : "rows"}.`,
          rowLine,
        );
      }
    }
    cells = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === ",") {
      pushField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      endRow();
      line++;
      rowLine = line;
    } else if (closedQuote) {
      throw new CsvError("Text follows a closing quote.", line);
    } else if (ch === '"') {
      if (field !== "") throw new CsvError("A quote appears inside an unquoted field.", line);
      quoted = true;
    } else {
      field += ch;
    }
  }
  if (quoted) throw new CsvError("A quoted field is never closed.", rowLine);
  if (field !== "" || cells.length > 0 || closedQuote) endRow();
  return rows;
}

/** Neutralizes spreadsheet formulas in exported cells (CSV injection, OWASP). */
export function csvCell(value: string | number): string {
  let text = String(value);
  // Leading spaces and full-width signs don't stop spreadsheets from reading a formula.
  if (typeof value === "string" && /^[\s]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r]/.test(text))
    text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
