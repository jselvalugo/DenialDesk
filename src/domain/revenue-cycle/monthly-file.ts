import { CsvError, parseCsv } from "@/lib/csv/parse";

/**
 * Monthly practice-management export (charges and payments by line), as used by RevCycle IQ.
 * Columns from the RevCycle IQ build specification; header matching is case- and
 * punctuation-insensitive and accepts common aliases. Values are validated strictly: the whole
 * file is rejected if any row is invalid, so a month is never half-imported. Error messages name
 * the row and column, never the cell value (cells hold PHI).
 */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 50_000;
/** Pre-production accepts synthetic files only: every account number must carry this prefix. */
export const SYNTHETIC_ACCOUNT_PREFIX = "SYN-";

const COLUMNS = {
  patientName: { label: "Patient", aliases: ["patient", "patient name"], required: true },
  accountNumber: {
    label: "Account #",
    aliases: ["account #", "account", "account number", "acct"],
    required: true,
  },
  serviceDate: {
    label: "Svc Date",
    aliases: ["svc date", "service date", "dos", "date of service"],
    required: true,
  },
  cpt: { label: "CPT", aliases: ["cpt", "cpt code", "hcpcs", "procedure"], required: true },
  description: { label: "Description", aliases: ["description", "cpt description"], required: false },
  facility: { label: "Facility", aliases: ["facility", "facility name", "location"], required: false },
  payerName: { label: "Payer", aliases: ["payer", "payer name", "insurance"], required: false },
  payerClass: { label: "Payer Class", aliases: ["payer class", "financial class", "class"], required: true },
  status: { label: "Status", aliases: ["status", "claim status"], required: false },
  billed: {
    label: "Billed Charge",
    aliases: ["billed charge", "charge", "charges", "billed"],
    required: true,
  },
  payment: {
    label: "Total Payment",
    aliases: ["total payment", "payment", "payments", "paid"],
    required: true,
  },
  balance: { label: "Balance", aliases: ["balance", "ar balance"], required: true },
} as const;

type ColumnKey = keyof typeof COLUMNS;

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
  billedCents: number;
  paymentCents: number;
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

/** "$1,234.56", "1234.5", "(12.00)", "-12" → integer cents; null if not a money amount. */
export function parseMoney(raw: string): number | null {
  if (raw.trim() === "") return 0;
  let text = raw.trim().replace(/[$,\s]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  }
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return negative ? -cents : cents;
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

export function parseMonthlyFile(text: string, options: { syntheticOnly: boolean }): ParseResult {
  let rows: string[][];
  try {
    rows = parseCsv(text, { maxRows: MAX_ROWS + 1 });
  } catch (error) {
    if (error instanceof CsvError)
      return { ok: false, problems: [{ row: error.row, message: error.message }] };
    throw error;
  }
  if (rows.length < 2) return { ok: false, problems: [{ row: 1, message: "The file has no data rows." }] };

  const header = rows[0]!.map(normalize);
  const index = {} as Record<ColumnKey, number>;
  const missing: string[] = [];
  for (const [key, column] of Object.entries(COLUMNS) as [ColumnKey, (typeof COLUMNS)[ColumnKey]][]) {
    const at = header.findIndex((h) => (column.aliases as readonly string[]).includes(h));
    if (at === -1 && column.required) missing.push(column.label);
    index[key] = at;
  }
  if (missing.length > 0) {
    return { ok: false, problems: [{ row: 1, message: `Missing required columns: ${missing.join(", ")}.` }] };
  }

  const problems: FileProblem[] = [];
  const lines: MonthlyLine[] = [];
  const add = (row: number, message: string) => {
    if (problems.length < MAX_PROBLEMS) problems.push({ row, message });
  };
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]!;
    const rowNumber = r + 1;
    const cell = (key: ColumnKey) => (index[key] >= 0 ? (cells[index[key]] ?? "").trim() : "");
    const money = (key: ColumnKey) => {
      const value = parseMoney(cell(key));
      if (value === null) add(rowNumber, `${COLUMNS[key].label} isn't a dollar amount.`);
      return value ?? 0;
    };
    const accountNumber = cell("accountNumber");
    const serviceDate = parseServiceDate(cell("serviceDate"));
    if (!cell("patientName")) add(rowNumber, "Patient is blank.");
    if (!accountNumber) add(rowNumber, "Account # is blank.");
    else if (options.syntheticOnly && !accountNumber.startsWith(SYNTHETIC_ACCOUNT_PREFIX)) {
      add(
        rowNumber,
        `Account # must start with ${SYNTHETIC_ACCOUNT_PREFIX}: this environment accepts synthetic files only.`,
      );
    }
    if (!serviceDate) add(rowNumber, "Svc Date isn't a valid date (use MM/DD/YYYY).");
    for (const key of Object.keys(COLUMNS) as ColumnKey[]) {
      if (cell(key).length > 200) add(rowNumber, `${COLUMNS[key].label} is longer than 200 characters.`);
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
      balanceCents: money("balance"),
    });
  }
  if (lines.length > MAX_ROWS) {
    return {
      ok: false,
      problems: [{ row: MAX_ROWS + 2, message: `The file has more than ${MAX_ROWS} rows.` }],
    };
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, lines };
}

/** Header row for sample and template files. */
export const MONTHLY_FILE_HEADER = Object.values(COLUMNS).map((c) => c.label);
