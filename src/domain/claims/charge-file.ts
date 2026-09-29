import { CsvError, parseCsv, type CsvRow } from "@/lib/csv/parse";
import type { MessageKey, Messages } from "@/i18n/messages/types";
import type { Translator } from "@/i18n/translate";
import { SYNTHETIC_MARKER } from "@/domain/synthetic/generator";
import {
  MAX_COLUMNS,
  normalizeHeader,
  parseMoney,
  parseServiceDate,
  SYNTHETIC_ACCOUNT_PREFIX,
} from "@/domain/revenue-cycle/monthly-file";
import { CPT_HCPCS, ICD10CM, MAX_DIAGNOSES, MAX_MODIFIERS, MIN_SERVICE_DATE, MODIFIER } from "./correction";

/**
 * Charge capture file (docs/specs/claims.md C2): one CSV, one row per claim line, rows with the same
 * `Claim number` form one claim. Parsing is pure: nothing here reads the database, and nothing here
 * changes a value. Codes are stored as the file gives them (CLAUDE.md #8, R-3.10.1); a value that
 * doesn't pass its format check is a row error the person fixes in the file. Problems carry a stable
 * code, the physical line number, and the column name, never a cell value (cells hold PHI).
 */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5_000;
/**
 * ⚠️ VERIFY (edi-x12-specialist, before C3): the 837P professional service-line limit per claim. 50 is
 * carried from the spec (docs/specs/claims.md C2) and is not confirmed against the implementation guide.
 */
export const MAX_LINES_PER_CLAIM = 50;
/** Problems returned to the page and the downloadable report; the rest are only counted. */
export const MAX_REPORT_PROBLEMS = 1_000;
/** Problems shown on the page itself. */
export const SHOWN_PROBLEMS = 20;
const MAX_CELL = 200;

/** 1 cent to $99,999.99 per line: the C1 correction limit (`lineSchema`). */
export const MIN_CHARGE_CENTS = 1;
export const MAX_CHARGE_CENTS = 9_999_999;

const CLAIM_NUMBER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/;
const NPI = /^\d{10}$/;

const COLUMNS = {
  claimNumber: {
    label: "Claim number",
    aliases: ["claim number", "claim no", "claim"],
    required: true,
  },
  mrn: { label: "MRN", aliases: ["mrn", "medical record number", "patient mrn"], required: true },
  payer: { label: "Payer", aliases: ["payer", "payer name", "insurance"], required: true },
  serviceDate: {
    label: "Service date",
    aliases: ["service date", "date of service", "dos"],
    required: true,
  },
  diagnosisCodes: {
    label: "Diagnosis codes",
    aliases: ["diagnosis codes", "diagnosis code", "diagnosis", "icd 10", "icd10"],
    required: true,
  },
  procedureCode: {
    label: "Procedure code",
    aliases: ["procedure code", "cpt", "hcpcs", "cpt hcpcs"],
    required: true,
  },
  modifiers: { label: "Modifiers", aliases: ["modifiers", "modifier"], required: false },
  units: { label: "Units", aliases: ["units"], required: true },
  charge: { label: "Charge", aliases: ["charge", "charge amount", "charges"], required: true },
  providerNpi: {
    label: "Provider NPI",
    aliases: ["provider npi", "rendering npi", "npi"],
    required: false,
  },
  location: { label: "Location", aliases: ["location", "facility"], required: false },
} as const;

export type ChargeColumnKey = keyof typeof COLUMNS;

/** Header row of the template download; the English names are the file-format contract, in every language. */
export const CHARGE_FILE_HEADER: string[] = Object.values(COLUMNS).map((c) => c.label);

/** English header name of a column, for problems raised after parsing (matching against the practice's records). */
export function columnLabel(key: ChargeColumnKey): string {
  return COLUMNS[key].label;
}

/** The columns in the contract, in order, for the page's instructions. */
export const CHARGE_COLUMNS = (
  Object.entries(COLUMNS) as [ChargeColumnKey, (typeof COLUMNS)[ChargeColumnKey]][]
).map(([key, column]) => ({ key, label: column.label, required: column.required }));

/** Every problem code, each with its message (`claims` namespace) and whether it names a column. */
export const PROBLEM_MESSAGE_KEYS = {
  // File level
  no_data_rows: "import.problem.noDataRows",
  missing_columns: "import.problem.missingColumns",
  ambiguous_columns: "import.problem.ambiguousColumns",
  csv_too_many_columns: "import.problem.csvTooManyColumns",
  csv_too_many_rows: "import.problem.csvTooManyRows",
  csv_text_after_quote: "import.problem.csvTextAfterQuote",
  csv_quote_in_field: "import.problem.csvQuoteInField",
  csv_unclosed_quote: "import.problem.csvUnclosedQuote",
  already_imported: "import.problem.alreadyImported",
  // Per row
  too_long: "import.problem.tooLong",
  claim_number_blank: "import.problem.claimNumberBlank",
  claim_number_format: "import.problem.claimNumberFormat",
  claim_number_not_synthetic: "import.problem.claimNumberNotSynthetic",
  mrn_blank: "import.problem.mrnBlank",
  mrn_not_synthetic: "import.problem.mrnNotSynthetic",
  payer_blank: "import.problem.payerBlank",
  service_date_invalid: "import.problem.serviceDateInvalid",
  service_date_too_old: "import.problem.serviceDateTooOld",
  service_date_future: "import.problem.serviceDateFuture",
  diagnosis_blank: "import.problem.diagnosisBlank",
  diagnosis_format: "import.problem.diagnosisFormat",
  diagnosis_too_many: "import.problem.diagnosisTooMany",
  procedure_code_format: "import.problem.procedureCodeFormat",
  modifier_format: "import.problem.modifierFormat",
  modifier_too_many: "import.problem.modifierTooMany",
  units_invalid: "import.problem.unitsInvalid",
  charge_invalid: "import.problem.chargeInvalid",
  charge_range: "import.problem.chargeRange",
  provider_npi_format: "import.problem.providerNpiFormat",
  claim_fields_differ: "import.problem.claimFieldsDiffer",
  duplicate_line: "import.problem.duplicateLine",
  claim_rows_not_contiguous: "import.problem.claimRowsNotContiguous",
  too_many_lines: "import.problem.tooManyLines",
  // Matching against the practice's records
  patient_not_found: "import.problem.patientNotFound",
  payer_not_found: "import.problem.payerNotFound",
  payer_ambiguous: "import.problem.payerAmbiguous",
  provider_not_found: "import.problem.providerNotFound",
  location_not_found: "import.problem.locationNotFound",
  location_ambiguous: "import.problem.locationAmbiguous",
  claim_number_exists: "import.problem.claimNumberExists",
  matches_existing_claim: "import.problem.matchesExistingClaim",
  matches_claim_in_file: "import.problem.matchesClaimInFile",
} as const satisfies Record<string, MessageKey<"claims">>;

export type ChargeProblemCode = keyof typeof PROBLEM_MESSAGE_KEYS;

/** Duplicate-detection codes (they get their own audit reason, `duplicate`). */
export const DUPLICATE_CODES: readonly ChargeProblemCode[] = [
  "already_imported",
  "claim_number_exists",
  "matches_existing_claim",
  "matches_claim_in_file",
];

export interface ChargeProblem {
  /** Physical line number in the file (the header is line 1 when there is no blank line above it). */
  row: number;
  code: ChargeProblemCode;
  /** English header name of the column the problem is about, when it is about one. */
  column?: string;
  /** Numbers and fixed words only, never a cell value. */
  params?: Record<string, number | string>;
}

/** The sentence for one problem, in the user's language; never contains a cell value. */
export function problemMessage(problem: ChargeProblem, t: Translator<Messages["claims"]>): string {
  return t(PROBLEM_MESSAGE_KEYS[problem.code], { column: problem.column ?? "", ...problem.params });
}

export interface ChargeLine {
  /** Physical line number of the row this line came from. */
  rowNumber: number;
  procedureCode: string;
  modifiers: string[];
  units: number;
  chargeCents: number;
}

export interface ChargeClaim {
  claimNumber: string;
  mrn: string;
  payerText: string;
  serviceDate: string;
  diagnosisCodes: string[];
  /** Blank when the file gives none (the form's default provider applies). */
  providerNpi: string;
  /** Blank when the file gives none (the form's default location applies). */
  location: string;
  /** Row of the claim's first line: where claim-level problems are reported. */
  firstRow: number;
  lines: ChargeLine[];
}

export type ChargeParseResult =
  | { ok: true; rowCount: number; claims: ChargeClaim[] }
  | { ok: false; problems: ChargeProblem[]; total: number; rowCount: number };

/**
 * The identity of a service line for duplicate comparison: procedure code plus modifiers. Modifiers are
 * compared sorted, so the same modifiers in another order are the same service; only the comparison sorts,
 * nothing stored is reordered. (A claim has one date of service, so the date isn't part of a line's key.)
 */
export function lineServiceKey(procedureCode: string, modifiers: readonly string[]): string {
  return `${procedureCode}|${[...modifiers].sort().join(",")}`;
}

/** "E11.9, I10  Z00.00" to codes exactly as written; empty pieces dropped. Nothing is upper-cased or fixed. */
export function splitAsGiven(text: string): string[] {
  return text.split(/[\s,;]+/).filter(Boolean);
}

export interface ParseOptions {
  /** Synthetic-only environments require SYN- claim numbers and SYN MRNs. */
  syntheticOnly: boolean;
  /** Today's date in the practice's calendar (YYYY-MM-DD): a date of service can't be after it. */
  today: string;
}

const CSV_CODES = {
  tooManyColumns: "csv_too_many_columns",
  tooManyRows: "csv_too_many_rows",
  textAfterQuote: "csv_text_after_quote",
  quoteInUnquotedField: "csv_quote_in_field",
  unclosedQuote: "csv_unclosed_quote",
} as const satisfies Record<CsvError["code"], ChargeProblemCode>;

export function parseChargeFile(text: string, options: ParseOptions): ChargeParseResult {
  let rows: CsvRow[];
  try {
    rows = parseCsv(text, { maxRows: MAX_IMPORT_ROWS, maxColumns: MAX_COLUMNS, headerRows: 1 });
  } catch (error) {
    if (error instanceof CsvError) {
      return {
        ok: false,
        total: 1,
        rowCount: 0,
        problems: [{ row: error.row, code: CSV_CODES[error.code], params: error.params }],
      };
    }
    throw error;
  }
  if (rows.length < 2) {
    return { ok: false, total: 1, rowCount: 0, problems: [{ row: 1, code: "no_data_rows" }] };
  }

  const headerRow = rows[0]!;
  const header = headerRow.cells.map(normalizeHeader);
  const index = {} as Record<ChargeColumnKey, number>;
  const missing: string[] = [];
  const ambiguous: string[] = [];
  for (const [key, column] of Object.entries(COLUMNS) as [
    ChargeColumnKey,
    (typeof COLUMNS)[ChargeColumnKey],
  ][]) {
    const matches = header.flatMap((h, i) => ((column.aliases as readonly string[]).includes(h) ? [i] : []));
    if (matches.length === 0 && column.required) missing.push(column.label);
    if (matches.length > 1) ambiguous.push(column.label);
    index[key] = matches[0] ?? -1;
  }
  if (missing.length > 0) {
    return {
      ok: false,
      total: 1,
      rowCount: rows.length - 1,
      problems: [{ row: headerRow.line, code: "missing_columns", params: { columns: missing.join(", ") } }],
    };
  }
  if (ambiguous.length > 0) {
    return {
      ok: false,
      total: 1,
      rowCount: rows.length - 1,
      problems: [
        { row: headerRow.line, code: "ambiguous_columns", params: { columns: ambiguous.join(", ") } },
      ],
    };
  }

  const problems: ChargeProblem[] = [];
  let total = 0;
  const add = (
    row: number,
    code: ChargeProblemCode,
    key?: ChargeColumnKey,
    params?: ChargeProblem["params"],
  ) => {
    total++;
    if (problems.length < MAX_REPORT_PROBLEMS) {
      problems.push({
        row,
        code,
        ...(key ? { column: COLUMNS[key].label } : {}),
        ...(params ? { params } : {}),
      });
    }
  };

  const claims = new Map<string, ChargeClaim>();
  // A claim's lines must sit together and must not repeat: rows are merged by claim number, so a file
  // pasted twice, or two overlapping exports, would otherwise double the lines and the billed amount.
  const lineKeys = new Map<string, Set<string>>();
  const notContiguous = new Set<string>();
  let previousKey: string | null = null;
  // A bad claim number or MRN is reported once, on its first row, not once per line.
  const reportedNumbers = new Set<string>();
  for (let r = 1; r < rows.length; r++) {
    const { cells, line } = rows[r]!;
    const cell = (key: ChargeColumnKey) => (index[key] >= 0 ? (cells[index[key]] ?? "").trim() : "");
    for (const key of Object.keys(COLUMNS) as ChargeColumnKey[]) {
      if (cell(key).length > MAX_CELL) add(line, "too_long", key, { max: MAX_CELL });
    }

    // -- Claim number: the grouping key -------------------------------------------------------
    const claimNumber = cell("claimNumber");
    let groupKey: string | null = null;
    if (!claimNumber) add(line, "claim_number_blank", "claimNumber");
    else if (!CLAIM_NUMBER.test(claimNumber)) {
      if (!reportedNumbers.has(claimNumber)) add(line, "claim_number_format", "claimNumber");
      reportedNumbers.add(claimNumber);
    } else if (options.syntheticOnly && !claimNumber.startsWith(SYNTHETIC_ACCOUNT_PREFIX)) {
      if (!reportedNumbers.has(claimNumber))
        add(line, "claim_number_not_synthetic", "claimNumber", { prefix: SYNTHETIC_ACCOUNT_PREFIX });
      reportedNumbers.add(claimNumber);
    } else groupKey = claimNumber;

    const existing = groupKey ? claims.get(groupKey) : undefined;
    const previous = previousKey;
    previousKey = groupKey;
    if (groupKey && existing && previous !== groupKey && !notContiguous.has(groupKey)) {
      notContiguous.add(groupKey);
      add(line, "claim_rows_not_contiguous", "claimNumber");
    }

    // -- Claim-level columns: validated on the claim's first line, compared on the others --------
    const mrn = cell("mrn");
    const payerText = cell("payer");
    const dateText = cell("serviceDate");
    const dxText = cell("diagnosisCodes");
    const providerNpi = cell("providerNpi");
    const location = cell("location");
    const serviceDate = parseServiceDate(dateText);
    const diagnosisCodes = splitAsGiven(dxText);

    if (!existing) {
      if (!mrn) add(line, "mrn_blank", "mrn");
      else if (options.syntheticOnly && !mrn.toUpperCase().startsWith(SYNTHETIC_MARKER)) {
        add(line, "mrn_not_synthetic", "mrn", { prefix: SYNTHETIC_MARKER });
      }
      if (!payerText) add(line, "payer_blank", "payer");
      if (!serviceDate) add(line, "service_date_invalid", "serviceDate");
      else if (serviceDate < MIN_SERVICE_DATE) add(line, "service_date_too_old", "serviceDate");
      else if (serviceDate > options.today) add(line, "service_date_future", "serviceDate");
      if (diagnosisCodes.length === 0) add(line, "diagnosis_blank", "diagnosisCodes");
      else {
        if (diagnosisCodes.length > MAX_DIAGNOSES) {
          add(line, "diagnosis_too_many", "diagnosisCodes", { max: MAX_DIAGNOSES });
        }
        if (!diagnosisCodes.every((code) => ICD10CM.test(code)))
          add(line, "diagnosis_format", "diagnosisCodes");
      }
      if (providerNpi && !NPI.test(providerNpi)) add(line, "provider_npi_format", "providerNpi");
    } else {
      const differs: ChargeColumnKey[] = [];
      if (mrn !== existing.mrn) differs.push("mrn");
      if (payerText.toLowerCase() !== existing.payerText.toLowerCase()) differs.push("payer");
      if ((serviceDate ?? "") !== existing.serviceDate) differs.push("serviceDate");
      if (diagnosisCodes.join(" ") !== existing.diagnosisCodes.join(" ")) differs.push("diagnosisCodes");
      if (providerNpi !== existing.providerNpi) differs.push("providerNpi");
      if (location.toLowerCase() !== existing.location.toLowerCase()) differs.push("location");
      for (const key of differs) add(line, "claim_fields_differ", key);
    }

    // -- Line columns: every row ---------------------------------------------------------------
    const procedureCode = cell("procedureCode");
    if (!CPT_HCPCS.test(procedureCode)) add(line, "procedure_code_format", "procedureCode");
    const modifiers = splitAsGiven(cell("modifiers"));
    if (modifiers.length > MAX_MODIFIERS) add(line, "modifier_too_many", "modifiers", { max: MAX_MODIFIERS });
    else if (!modifiers.every((m) => MODIFIER.test(m))) add(line, "modifier_format", "modifiers");
    const unitsText = cell("units");
    const units = /^\d{1,4}$/.test(unitsText) ? Number(unitsText) : Number.NaN;
    if (!Number.isInteger(units) || units < 1 || units > 999) add(line, "units_invalid", "units");
    const chargeText = cell("charge");
    const chargeCents = chargeText === "" ? null : parseMoney(chargeText);
    if (chargeCents === null) add(line, "charge_invalid", "charge");
    else if (chargeCents < MIN_CHARGE_CENTS || chargeCents > MAX_CHARGE_CENTS)
      add(line, "charge_range", "charge");

    if (!groupKey) continue;
    const chargeLine: ChargeLine = {
      rowNumber: line,
      procedureCode,
      modifiers,
      units,
      chargeCents: chargeCents ?? 0,
    };
    const key = lineServiceKey(procedureCode, modifiers);
    if (existing) {
      const seen = lineKeys.get(groupKey)!;
      if (seen.has(key)) {
        // Not merged: a repeated line is refused, never added twice.
        add(line, "duplicate_line", "procedureCode");
        continue;
      }
      seen.add(key);
      if (existing.lines.length >= MAX_LINES_PER_CLAIM) {
        if (existing.lines.length === MAX_LINES_PER_CLAIM) {
          add(line, "too_many_lines", "claimNumber", { max: MAX_LINES_PER_CLAIM });
          // Push a sentinel so the message shows once per claim.
          existing.lines.push(chargeLine);
        }
      } else existing.lines.push(chargeLine);
    } else {
      lineKeys.set(groupKey, new Set([key]));
      claims.set(groupKey, {
        claimNumber,
        mrn,
        payerText,
        serviceDate: serviceDate ?? "",
        diagnosisCodes,
        providerNpi,
        location,
        firstRow: line,
        lines: [chargeLine],
      });
    }
  }
  if (total > 0) return { ok: false, problems, total, rowCount: rows.length - 1 };
  return { ok: true, rowCount: rows.length - 1, claims: [...claims.values()] };
}

export type UploadCheckCode = "chooseFile" | "notCsv" | "tooLarge" | "confirmSynthetic";

export const UPLOAD_CHECK_KEYS = {
  chooseFile: "import.error.chooseFile",
  notCsv: "import.error.notCsv",
  tooLarge: "import.error.tooLarge",
  confirmSynthetic: "import.error.confirmSynthetic",
} as const satisfies Record<UploadCheckCode, MessageKey<"claims">>;

/** Checks on the uploaded file itself, before its contents are read. */
export function checkChargeUpload(file: {
  name: string;
  size: number;
  attestedSynthetic: boolean;
  syntheticOnly: boolean;
}): UploadCheckCode | null {
  if (file.size === 0) return "chooseFile";
  if (!/\.csv$/i.test(file.name)) return "notCsv";
  if (file.size > MAX_IMPORT_BYTES) return "tooLarge";
  if (file.syntheticOnly && !file.attestedSynthetic) return "confirmSynthetic";
  return null;
}
