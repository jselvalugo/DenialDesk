import { CsvError, parseCsv } from "@/lib/csv/parse";
import { parseMoney, parseServiceDate } from "./monthly-file";

/**
 * Receivable aging, month-to-month roll-forward, and payments-to-deposits reconciliation
 * (docs/specs/revenue-cycle-accounting.md, B4). Pure functions over integer cents.
 */

export const AGING_BUCKETS = [
  { key: "0_30", label: "0–30 days", maxDays: 30 },
  { key: "31_60", label: "31–60", maxDays: 60 },
  { key: "61_90", label: "61–90", maxDays: 90 },
  { key: "91_120", label: "91–120", maxDays: 120 },
  { key: "over_120", label: "Over 120", maxDays: Infinity },
] as const;
export type BucketKey = (typeof AGING_BUCKETS)[number]["key"];

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/** Age in days from service date to the month's last day (never negative). */
export function bucketFor(serviceDate: string, asOf: string): BucketKey {
  const age = Math.max(0, days(serviceDate, asOf));
  return AGING_BUCKETS.find((b) => age <= b.maxDays)!.key;
}

export interface AgingLine {
  payerClass: string;
  serviceDate: string;
  balanceCents: number;
}

export interface AgingRow {
  payerClass: string;
  buckets: Record<BucketKey, number>;
  totalCents: number;
}

export interface Aging {
  rows: AgingRow[];
  totals: AgingRow;
  /** Negative balances, by class: money that may be owed back (refunds aren't tracked here). */
  credits: Array<{ payerClass: string; lines: number; totalCents: number }>;
}

const emptyBuckets = () =>
  Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, 0])) as Record<BucketKey, number>;

/** Open balances by financial class and age; credit balances are listed apart, never netted. */
export function ageReceivables(lines: AgingLine[], asOf: string): Aging {
  const byClass = new Map<string, AgingRow>();
  const credits = new Map<string, { payerClass: string; lines: number; totalCents: number }>();
  const totals: AgingRow = { payerClass: "All classes", buckets: emptyBuckets(), totalCents: 0 };
  for (const line of lines) {
    if (line.balanceCents < 0) {
      const credit = credits.get(line.payerClass) ?? { payerClass: line.payerClass, lines: 0, totalCents: 0 };
      credit.lines += 1;
      credit.totalCents += line.balanceCents;
      credits.set(line.payerClass, credit);
      continue;
    }
    if (line.balanceCents === 0) continue;
    const row = byClass.get(line.payerClass) ?? {
      payerClass: line.payerClass,
      buckets: emptyBuckets(),
      totalCents: 0,
    };
    const bucket = bucketFor(line.serviceDate, asOf);
    row.buckets[bucket] += line.balanceCents;
    row.totalCents += line.balanceCents;
    totals.buckets[bucket] += line.balanceCents;
    totals.totalCents += line.balanceCents;
    byClass.set(line.payerClass, row);
  }
  const byTotal = <T extends { totalCents: number; payerClass: string }>(a: T, b: T) =>
    Math.abs(b.totalCents) - Math.abs(a.totalCents) || (a.payerClass < b.payerClass ? -1 : 1);
  return { rows: [...byClass.values()].sort(byTotal), totals, credits: [...credits.values()].sort(byTotal) };
}

export interface MonthTotals {
  periodYear: number;
  periodMonth: number;
  chargesCents: number;
  paymentsCents: number;
  adjustmentsCents: number;
  /** Open balance at month-end (all lines, credits included). */
  balanceCents: number;
}

export interface RollForwardRow extends MonthTotals {
  /** Prior month's closing balance; null when the prior month wasn't imported. */
  openingCents: number | null;
  /** closing − (opening + charges − payments − adjustments); null without an opening. */
  unexplainedCents: number | null;
}

const monthIndex = (m: { periodYear: number; periodMonth: number }) => m.periodYear * 12 + m.periodMonth - 1;

/** Month-to-month roll-forward, oldest first. Reports differences; it doesn't block anything. */
export function rollForward(months: MonthTotals[]): RollForwardRow[] {
  const sorted = [...months].sort((a, b) => monthIndex(a) - monthIndex(b));
  return sorted.map((m, i) => {
    const prior = sorted[i - 1];
    const opening = prior && monthIndex(prior) === monthIndex(m) - 1 ? prior.balanceCents : null;
    return {
      ...m,
      openingCents: opening,
      unexplainedCents:
        opening === null
          ? null
          : m.balanceCents - (opening + m.chargesCents - m.paymentsCents - m.adjustmentsCents),
    };
  });
}

export interface ReconciliationRow {
  periodYear: number;
  periodMonth: number;
  paymentsCents: number;
  depositsCents: number;
  /** Payments − deposits this month. */
  differenceCents: number;
  /** Running payments − deposits since the first month shown: the clearing account's balance. */
  clearingCents: number;
  /** The clearing balance grew and is positive: payments posted but not (yet) deposited. */
  growing: boolean;
}

/**
 * Payments posted in the practice-management system against deposits recorded by the bank,
 * month by month. The running difference is what sits in the payments-clearing account.
 */
export function reconcileDeposits(
  months: Array<{ periodYear: number; periodMonth: number; paymentsCents: number }>,
  deposits: Array<{ depositDate: string; amountCents: number }>,
): ReconciliationRow[] {
  const byMonth = new Map<number, number>();
  for (const d of deposits) {
    const key = Number(d.depositDate.slice(0, 4)) * 12 + Number(d.depositDate.slice(5, 7)) - 1;
    byMonth.set(key, (byMonth.get(key) ?? 0) + d.amountCents);
  }
  let clearing = 0;
  return [...months]
    .sort((a, b) => monthIndex(a) - monthIndex(b))
    .map((m) => {
      const depositsCents = byMonth.get(monthIndex(m)) ?? 0;
      const differenceCents = m.paymentsCents - depositsCents;
      const previous = clearing;
      clearing += differenceCents;
      return {
        periodYear: m.periodYear,
        periodMonth: m.periodMonth,
        paymentsCents: m.paymentsCents,
        depositsCents,
        differenceCents,
        clearingCents: clearing,
        growing: clearing > 0 && clearing > previous,
      };
    });
}

// ---------------------------------------------------------------------------------------------
// Bank deposit file
// ---------------------------------------------------------------------------------------------

export const DEPOSIT_MAX_BYTES = 1024 * 1024;
export const DEPOSIT_MAX_ROWS = 5_000;

export interface DepositLine {
  rowNumber: number;
  depositDate: string;
  amountCents: number;
}

export type DepositParse =
  { ok: true; deposits: DepositLine[] } | { ok: false; problems: Array<{ row: number; message: string }> };

const normalize = (h: string) =>
  h
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();
const DATE_HEADERS = ["date", "deposit date", "posted date", "posting date"];
const AMOUNT_HEADERS = ["amount", "deposit amount", "credit"];

/**
 * Bank deposits: only the date and amount columns are read; any other column (descriptions,
 * account numbers) is ignored and never stored (bank data needs field-level encryption,
 * CLAUDE.md #6). The whole file is rejected on any bad row; messages never echo values.
 */
export function parseDepositFile(text: string): DepositParse {
  let rows;
  try {
    rows = parseCsv(text, { maxRows: DEPOSIT_MAX_ROWS, maxColumns: 50, headerRows: 1 });
  } catch (error) {
    if (error instanceof CsvError)
      return { ok: false, problems: [{ row: error.row, message: error.message }] };
    throw error;
  }
  if (rows.length < 2) return { ok: false, problems: [{ row: 1, message: "The file has no data rows." }] };
  const header = rows[0]!.cells.map(normalize);
  const find = (names: string[]) => header.flatMap((h, i) => (names.includes(h) ? [i] : []));
  const dateCols = find(DATE_HEADERS);
  const amountCols = find(AMOUNT_HEADERS);
  if (dateCols.length !== 1 || amountCols.length !== 1) {
    return {
      ok: false,
      problems: [
        { row: rows[0]!.line, message: "The file needs exactly one Date column and one Amount column." },
      ],
    };
  }
  const problems: Array<{ row: number; message: string }> = [];
  const deposits: DepositLine[] = [];
  for (const { cells, line } of rows.slice(1)) {
    const date = parseServiceDate(cells[dateCols[0]!] ?? "");
    const amount = parseMoney(cells[amountCols[0]!] ?? "");
    if (!date) problems.push({ row: line, message: "Date isn't a valid date (use MM/DD/YYYY)." });
    if (amount === null)
      problems.push({ row: line, message: "Amount isn't a valid dollar amount (up to $10,000,000)." });
    else if (amount === 0) problems.push({ row: line, message: "Amount is zero." });
    if (problems.length >= 20) break;
    if (date && amount) deposits.push({ rowNumber: line, depositDate: date, amountCents: amount });
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, deposits };
}
