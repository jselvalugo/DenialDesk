import { CsvError, parseCsv, type CsvRow } from "@/lib/csv/parse";
import type { MessageKey } from "@/i18n/messages/types";
import { englishRevenue, type RevenueT, csvProblemMessage } from "./i18n";

/**
 * Month-end activity file from the practice-management (PM) system, DenialDesk's own layout: one
 * row per charge line that had activity in the period or is still open at period end. Charges,
 * payments, and adjustments are the amounts *posted in the period*; the balance is the line's open
 * balance at period end. So the file carries both the month's ledger activity and the full open
 * receivable for aging. Header matching is case- and punctuation-insensitive and accepts common
 * alternative names. Values are validated strictly: the whole file is rejected if any row is
 * invalid, so a month is never half-imported. Error messages name the row and column, never the
 * cell value (cells hold PHI).
 */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 50_000;
export const MAX_COLUMNS = 100;
/** Pre-production accepts synthetic files only: every account number must carry this prefix. */
export const SYNTHETIC_ACCOUNT_PREFIX = "SYN-";

const COLUMNS = {
  patientName: { label: "Patient name", aliases: ["patient name", "patient"], required: true },
  accountNumber: {
    label: "Account number",
    aliases: ["account number", "account", "account no", "acct"],
    required: true,
  },
  serviceDate: {
    label: "Service date",
    aliases: ["service date", "date of service", "dos"],
    required: true,
  },
  cpt: { label: "Procedure code", aliases: ["procedure code", "cpt", "hcpcs", "cpt hcpcs"], required: true },
  description: { label: "Description", aliases: ["description", "procedure description"], required: false },
  facility: { label: "Facility", aliases: ["facility", "location", "place of service"], required: false },
  payerName: { label: "Payer", aliases: ["payer", "insurance", "payer name"], required: false },
  payerClass: { label: "Financial class", aliases: ["financial class", "payer class"], required: true },
  status: { label: "Status", aliases: ["status", "line status"], required: false },
  billed: { label: "Charges", aliases: ["charges", "charge amount"], required: true },
  payment: { label: "Payments", aliases: ["payments", "payment amount"], required: true },
  adjustment: { label: "Adjustments", aliases: ["adjustments", "adjustment amount"], required: true },
  balance: { label: "Balance", aliases: ["balance", "open balance", "ending balance"], required: true },
} as const;

type ColumnKey = keyof typeof COLUMNS;

/**
 * On-screen name for each column, separate from `COLUMNS[key].label` above: that English label is
 * part of the header-matching contract and the template file (`MONTHLY_FILE_HEADER`) and never
 * changes with the language; this is only what error messages and the import instructions show.
 */
/** On-screen names of the columns (tables, hints). The CSV header contract itself is `COLUMNS[key].label`. */
export const COLUMN_LABEL_KEYS: Record<ColumnKey, MessageKey<"revenue">> = {
  patientName: "import.column.patientName",
  accountNumber: "import.column.accountNumber",
  serviceDate: "import.column.serviceDate",
  cpt: "import.column.cpt",
  description: "import.column.description",
  facility: "import.column.facility",
  payerName: "import.column.payerName",
  payerClass: "import.column.payerClass",
  status: "import.column.status",
  billed: "import.column.billed",
  payment: "import.column.payment",
  adjustment: "import.column.adjustment",
  balance: "import.column.balance",
};

export interface MonthlyLine {
  rowNumber: number;
  patientName: string;
  accountNumber: string;
  serviceDate: string;
  cpt: string;
  description: string;
  facility: string;
  payerName: string;
  payerClass: string;
  status: string;
  /** Charges posted in the period (zero for older lines with only payments or adjustments). */
  billedCents: number;
  /** Payments posted in the period. */
  paymentCents: number;
  /** Adjustments (write-offs) posted in the period; negative for reversals. */
  adjustmentCents: number;
  /** Open balance at period end; negative is a credit balance. */
  balanceCents: number;
}

export interface FileProblem {
  row: number;
  message: string;
}

export type ParseResult = { ok: true; lines: MonthlyLine[] } | { ok: false; problems: FileProblem[] };

const normalize = (header: string) =>
  header
    .toLowerCase()
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();

/** Largest amount accepted on one line ($10,000,000), so file totals stay exact in JavaScript. */
export const MAX_LINE_CENTS = 1_000_000_000;

const AMOUNT = /^\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/**
 * Strict dollar amounts → integer cents: "$1,234.56", "1234.5", "(12.00)", "-$12", "" (= 0).
 * Rejects misplaced thousands separators ("1,2,3"), mixed signs ("(-5)"), more than two decimals,
 * and amounts over MAX_LINE_CENTS. Returns null when rejected.
 */
export function parseMoney(raw: string): number | null {
  let text = raw.trim();
  if (text === "") return 0;
  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1).trim();
  } else if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1).trim();
  }
  const match = AMOUNT.exec(text);
  if (!match) return null;
  const cents = Number(match[1]!.replace(/,/g, "")) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (cents > MAX_LINE_CENTS) return null;
  return negative && cents !== 0 ? -cents : cents;
}

/** MM/DD/YYYY, M/D/YYYY, or YYYY-MM-DD → YYYY-MM-DD; null if not a real calendar date. */
export function parseServiceDate(raw: string): string | null {
  const text = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (!match) return null;
    [m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

const MAX_PROBLEMS = 20;

export function parseMonthlyFile(
  text: string,
  options: { syntheticOnly: boolean },
  t: RevenueT = englishRevenue,
): ParseResult {
  let rows: CsvRow[];
  try {
    rows = parseCsv(text, { maxRows: MAX_ROWS, maxColumns: MAX_COLUMNS, headerRows: 1 });
  } catch (error) {
    if (error instanceof CsvError)
      return {
        ok: false,
        problems: [{ row: error.row, message: csvProblemMessage(error, t) }],
      };
    throw error;
  }
  if (rows.length < 2) return { ok: false, problems: [{ row: 1, message: t("import.error.noDataRows") }] };

  const headerRow = rows[0]!;
  const header = headerRow.cells.map(normalize);
  const index = {} as Record<ColumnKey, number>;
  const missing: string[] = [];
  const ambiguous: string[] = [];
  for (const [key, column] of Object.entries(COLUMNS) as [ColumnKey, (typeof COLUMNS)[ColumnKey]][]) {
    const matches = header.flatMap((h, i) => ((column.aliases as readonly string[]).includes(h) ? [i] : []));
    if (matches.length === 0 && column.required) missing.push(column.label);
    if (matches.length > 1) ambiguous.push(column.label);
    index[key] = matches[0] ?? -1;
  }
  if (missing.length > 0) {
    return {
      ok: false,
      problems: [
        { row: headerRow.line, message: t("import.error.missingColumns", { columns: missing.join(", ") }) },
      ],
    };
  }
  if (ambiguous.length > 0) {
    return {
      ok: false,
      problems: [
        {
          row: headerRow.line,
          message: t("import.error.ambiguousColumns", { columns: ambiguous.join(", ") }),
        },
      ],
    };
  }

  const problems: FileProblem[] = [];
  const lines: MonthlyLine[] = [];
  const add = (row: number, message: string) => {
    if (problems.length < MAX_PROBLEMS) problems.push({ row, message });
  };
  for (let r = 1; r < rows.length; r++) {
    const { cells, line: rowNumber } = rows[r]!;
    const cell = (key: ColumnKey) => (index[key] >= 0 ? (cells[index[key]] ?? "").trim() : "");
    const money = (key: ColumnKey) => {
      const value = parseMoney(cell(key));
      if (value === null) add(rowNumber, t("import.error.invalidAmount", { column: COLUMNS[key].label }));
      return value ?? 0;
    };
    const accountNumber = cell("accountNumber");
    const serviceDate = parseServiceDate(cell("serviceDate"));
    if (!cell("patientName")) add(rowNumber, t("import.error.patientNameBlank"));
    if (!accountNumber) add(rowNumber, t("import.error.accountNumberBlank"));
    else if (options.syntheticOnly && !accountNumber.startsWith(SYNTHETIC_ACCOUNT_PREFIX)) {
      add(rowNumber, t("import.error.syntheticAccountRequired", { prefix: SYNTHETIC_ACCOUNT_PREFIX }));
    }
    if (!serviceDate) add(rowNumber, t("import.error.serviceDateInvalid"));
    for (const key of Object.keys(COLUMNS) as ColumnKey[]) {
      if (cell(key).length > 200) {
        add(rowNumber, t("import.error.tooLong", { column: COLUMNS[key].label }));
      }
    }
    lines.push({
      rowNumber,
      patientName: cell("patientName"),
      accountNumber,
      serviceDate: serviceDate ?? "",
      cpt: cell("cpt"),
      description: cell("description"),
      facility: cell("facility"),
      payerName: cell("payerName"),
      payerClass: cell("payerClass"),
      status: cell("status"),
      billedCents: money("billed"),
      paymentCents: money("payment"),
      adjustmentCents: money("adjustment"),
      balanceCents: money("balance"),
    });
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, lines };
}

/** Header row for sample and template files. */
export const MONTHLY_FILE_HEADER = Object.values(COLUMNS).map((c) => c.label);

export type UploadCheck = { ok: true } | { ok: false; error: string };

/** Checks on the uploaded file itself, before its contents are read. */
export function checkUpload(
  file: {
    name: string;
    size: number;
    attestedSynthetic: boolean;
    syntheticOnly: boolean;
  },
  t: RevenueT = englishRevenue,
): UploadCheck {
  if (file.size === 0) return { ok: false, error: t("import.error.chooseFile") };
  if (!/\.csv$/i.test(file.name)) {
    return { ok: false, error: t("import.error.notCsv") };
  }
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: t("import.error.tooLarge") };
  if (file.syntheticOnly && !file.attestedSynthetic) {
    return { ok: false, error: t("import.error.confirmSynthetic") };
  }
  return { ok: true };
}

/** Decodes the upload as UTF-8, refusing binary or other encodings. */
export function decodeUpload(bytes: ArrayBuffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Last calendar day of a period, YYYY-MM-DD. */
export function periodEnd(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
