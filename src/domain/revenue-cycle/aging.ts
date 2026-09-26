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

/**
 * Open balances already summed by class and bucket (the database does the bucketing, so only
 * totals leave it); `bucket` null holds the class's credit (negative) balances.
 */
export interface AgingTotal {
  payerClass: string;
  bucket: BucketKey | null;
  cents: number;
  lines: number;
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
export function ageReceivables(totals: AgingTotal[]): Aging {
  const byClass = new Map<string, AgingRow>();
  const credits = new Map<string, { payerClass: string; lines: number; totalCents: number }>();
  const all: AgingRow = { payerClass: "All classes", buckets: emptyBuckets(), totalCents: 0 };
  for (const t of totals) {
    if (t.bucket === null) {
      const credit = credits.get(t.payerClass) ?? { payerClass: t.payerClass, lines: 0, totalCents: 0 };
      credit.lines += t.lines;
      credit.totalCents += t.cents;
      credits.set(t.payerClass, credit);
      continue;
    }
    const row = byClass.get(t.payerClass) ?? {
      payerClass: t.payerClass,
      buckets: emptyBuckets(),
      totalCents: 0,
    };
    row.buckets[t.bucket] += t.cents;
    row.totalCents += t.cents;
    all.buckets[t.bucket] += t.cents;
    all.totalCents += t.cents;
    byClass.set(t.payerClass, row);
  }
  const byTotal = <T extends { totalCents: number; payerClass: string }>(a: T, b: T) =>
    Math.abs(b.totalCents) - Math.abs(a.totalCents) || (a.payerClass < b.payerClass ? -1 : 1);
  return {
    rows: [...byClass.values()].sort(byTotal),
    totals: all,
    credits: [...credits.values()].sort(byTotal),
  };
}

/** Sums lines into aging totals in memory (tests and synthetic checks; reports bucket in SQL). */
export function agingTotals(
  lines: Array<{ payerClass: string; serviceDate: string; balanceCents: number }>,
  asOf: string,
): AgingTotal[] {
  const map = new Map<string, AgingTotal>();
  for (const l of lines) {
    if (l.balanceCents === 0) continue;
    const bucket = l.balanceCents < 0 ? null : bucketFor(l.serviceDate, asOf);
    const key = `${l.payerClass}|${bucket}`;
    const t = map.get(key) ?? { payerClass: l.payerClass, bucket, cents: 0, lines: 0 };
    t.cents += l.balanceCents;
    t.lines += 1;
    map.set(key, t);
  }
  return [...map.values()];
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

/**
 * When undeposited payments exceed this share of the month's payments, the month is flagged for
 * follow-up. A product default (one to two weeks of normal deposit lag), not a legal threshold.
 */
export const CLEARING_ALERT_SHARE_BPS = 5_000;

export interface ReconciliationRow {
  periodYear: number;
  periodMonth: number;
  paymentsCents: number;
  depositsCents: number;
  /** Payments − deposits this month. */
  differenceCents: number;
  /**
   * Payments posted minus deposits since the first month of the run (restarting after a missing
   * month). Positive: posted but not yet deposited; negative: deposited but not posted.
   */
  clearingCents: number;
  /** The run restarted here because the prior month has no activity file. */
  afterGap: boolean;
  /** Undeposited payments exceed CLEARING_ALERT_SHARE_BPS of the month's payments. */
  alert: boolean;
}

/**
 * Payments posted in the practice-management system against deposits recorded by the bank,
 * month by month, with the running difference (the payments-clearing account since the run began).
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
  let previous: number | null = null;
  return [...months]
    .sort((a, b) => monthIndex(a) - monthIndex(b))
    .map((m) => {
      const index = monthIndex(m);
      const afterGap = previous !== null && index !== previous + 1;
      if (afterGap) clearing = 0;
      previous = index;
      const depositsCents = byMonth.get(index) ?? 0;
      const differenceCents = m.paymentsCents - depositsCents;
      clearing += differenceCents;
      return {
        periodYear: m.periodYear,
        periodMonth: m.periodMonth,
        paymentsCents: m.paymentsCents,
        depositsCents,
        differenceCents,
        clearingCents: clearing,
        afterGap,
        alert: clearing * 10_000 > m.paymentsCents * CLEARING_ALERT_SHARE_BPS,
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
const AMOUNT_HEADERS = ["amount", "deposit amount"];
/** Pre-production accepts synthetic deposit files only: each row carries this marker. */
export const SYNTHETIC_DEPOSIT_MARKER = "SYN-DEPOSIT";
const MARKER_HEADERS = ["synthetic marker"];

/**
 * Bank deposits: only the date and amount columns are read; any other column (descriptions,
 * account numbers) is ignored and never stored (bank data needs field-level encryption,
 * CLAUDE.md #6). The whole file is rejected on any bad row; messages never echo values.
 */
export function parseDepositFile(text: string, options: { syntheticOnly: boolean }): DepositParse {
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
  const markerCols = find(MARKER_HEADERS);
  if (options.syntheticOnly && markerCols.length !== 1) {
    return {
      ok: false,
      problems: [
        {
          row: rows[0]!.line,
          message: `This environment accepts synthetic deposit files only: add a "Synthetic marker" column with ${SYNTHETIC_DEPOSIT_MARKER} on every row.`,
        },
      ],
    };
  }
  const problems: Array<{ row: number; message: string }> = [];
  const deposits: DepositLine[] = [];
  for (const { cells, line } of rows.slice(1)) {
    const date = parseServiceDate(cells[dateCols[0]!] ?? "");
    const rawAmount = (cells[amountCols[0]!] ?? "").trim();
    const amount = rawAmount === "" ? null : parseMoney(rawAmount);
    if (options.syntheticOnly && (cells[markerCols[0]!] ?? "").trim() !== SYNTHETIC_DEPOSIT_MARKER) {
      problems.push({ row: line, message: `Synthetic marker isn't ${SYNTHETIC_DEPOSIT_MARKER}.` });
    }
    if (!date) problems.push({ row: line, message: "Date isn't a valid date (use MM/DD/YYYY)." });
    else if (date < "2000-01-01" || date > "2100-12-31") {
      problems.push({ row: line, message: "Date is outside 2000–2100." });
    }
    if (rawAmount === "") problems.push({ row: line, message: "Amount is blank." });
    else if (amount === null)
      problems.push({ row: line, message: "Amount isn't a valid dollar amount (up to $10,000,000)." });
    else if (amount === 0) problems.push({ row: line, message: "Amount is zero." });
    if (problems.length >= 20) break;
    if (date && amount) deposits.push({ rowNumber: line, depositDate: date, amountCents: amount });
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, deposits };
}
