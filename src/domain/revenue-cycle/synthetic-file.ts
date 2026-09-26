import { csvCell } from "@/lib/csv/parse";
import { createRandom, FIRST_NAMES, LAST_NAMES } from "@/domain/synthetic/generator";
import { MONTHLY_FILE_HEADER, SYNTHETIC_ACCOUNT_PREFIX, type MonthlyLine } from "./monthly-file";

// Synthetic practice-management activity (R-15.1): fictional patients and payers, SYN- account
// numbers. A small simulation: charges are adjudicated weeks or months later (the payer pays its
// share and the rest of the charge is adjusted off), patients pay their share later or not at
// all, and each month's file lists every line with activity that month or still open at month-end.
// Deterministic per seed, and consecutive months roll forward exactly.

const SERVICES: ReadonlyArray<readonly [string, string, number, number]> = [
  // CPT/HCPCS, description, charge $, weight
  ["99213", "Office visit, established, low", 145, 30],
  ["99214", "Office visit, established, moderate", 210, 22],
  ["99203", "Office visit, new, low", 190, 8],
  ["99396", "Preventive visit, established, 40-64", 260, 6],
  ["90471", "Immunization administration", 35, 5],
  ["93000", "Electrocardiogram, complete", 60, 6],
  ["36415", "Routine venipuncture", 18, 8],
  ["9921", "Office visit (code keyed short)", 145, 1],
];

// Financial class, fictional payer, weight, allowed % of the charge, patient share % of allowed.
const CLASSES: ReadonlyArray<readonly [string, string, number, number, number]> = [
  ["COMM", "Gulf Coast Mutual (synthetic)", 28, 70, 20],
  ["HMO", "Sunward HMO (synthetic)", 16, 60, 10],
  ["ERISA", "Harborline Employer Plan (synthetic)", 6, 72, 20],
  ["MCR", "Medicare Part B (synthetic)", 20, 45, 20],
  ["MA", "Keystone Advantage (synthetic)", 10, 50, 10],
  ["SMMC", "Palmetto Medicaid Plan (synthetic)", 6, 35, 0],
  ["WC", "Coastal Workers' Comp (synthetic)", 2, 80, 0],
  ["SELF", "Self-pay", 12, 100, 100],
];

interface Posting {
  month: number;
  payment: number;
  adjustment: number;
}

interface SimCharge {
  month: number;
  line: Omit<MonthlyLine, "rowNumber" | "billedCents" | "paymentCents" | "adjustmentCents" | "balanceCents">;
  charge: number;
  postings: Posting[];
  /** Month the charge was voided, if it was voided after the month it was posted. */
  voidedIn?: number;
  /** Month the open balance moved to patient responsibility (financial class SELF). */
  toPatientIn?: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

function monthOf(startYear: number, startMonth: number, offset: number) {
  const index = startYear * 12 + (startMonth - 1) + offset;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export interface SyntheticMonth {
  periodYear: number;
  periodMonth: number;
  lines: MonthlyLine[];
}

/** Consecutive monthly activity files for `months` months ending with the given period. */
export function generateMonthlyFiles(options: {
  seed: number;
  periodYear: number;
  periodMonth: number;
  months: number;
  facilities: string[];
  chargesPerMonth?: number;
}): SyntheticMonth[] {
  const random = createRandom(options.seed);
  const facilities = options.facilities.length > 0 ? options.facilities : ["Main clinic"];
  const perMonth = options.chargesPerMonth ?? 120;
  const start = monthOf(options.periodYear, options.periodMonth, -(options.months - 1));
  const charges: SimCharge[] = [];

  for (let m = 0; m < options.months; m++) {
    const { year, month } = monthOf(start.year, start.month, m);
    const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let i = 0; i < perMonth; i++) {
      const [cpt, description, dollars] = random.weighted(SERVICES.map((s) => [s, s[3]] as const));
      const [payerClass, payerName, , allowedPct, patientPct] = random.weighted(
        CLASSES.map((c) => [c, c[2]] as const),
      );
      const special = random.int(1, 60);
      const base = {
        patientName: `${random.pick(LAST_NAMES)}, ${random.pick(FIRST_NAMES)}`,
        accountNumber: `${SYNTHETIC_ACCOUNT_PREFIX}${String(100_000 + random.int(0, 899_999))}`,
        serviceDate: `${year}-${pad(month)}-${pad(random.int(1, days))}`,
        cpt,
        description,
        facility: random.pick(facilities),
        payerName,
        payerClass,
        status: "",
      };
      if (special === 1) {
        // Late-payment interest added to a claim payment: charged and paid the same month.
        const amount = random.int(5, 40) * 100;
        charges.push({
          month: m,
          line: { ...base, description: "Prompt-pay interest", status: "INTEREST" },
          charge: amount,
          postings: [{ month: m, payment: amount, adjustment: 0 }],
        });
        continue;
      }
      if (special === 2) {
        // A charge entered in error and voided in the same month.
        const amount = dollars * 100;
        charges.push({
          month: m,
          line: { ...base, status: "VOID" },
          charge: amount,
          postings: [{ month: m, payment: 0, adjustment: amount }],
        });
        continue;
      }
      if (special === 3) {
        // A Category II quality code at a nominal $0.01 in this synthetic data, written off the
        // same month.
        charges.push({
          month: m,
          line: { ...base, cpt: "3074F", description: "Most recent systolic BP < 130" },
          charge: 1,
          postings: [{ month: m, payment: 0, adjustment: 1 }],
        });
        continue;
      }
      const charge = dollars * 100;
      if (special === 4) {
        // A charge voided the following month, after it was already posted.
        charges.push({
          month: m,
          line: base,
          charge,
          postings: [{ month: m + 1, payment: 0, adjustment: charge }],
          voidedIn: m + 1,
        });
        continue;
      }
      const allowed = Math.round((charge * allowedPct) / 100);
      const patientShare = Math.round((allowed * patientPct) / 100);
      const postings: Posting[] = [];
      const lag = random.weighted([
        [0, 25],
        [1, 50],
        [2, 15],
        [3, 6],
        [6, 4],
      ] as const);
      if (payerClass !== "SELF") {
        postings.push({ month: m + lag, payment: allowed - patientShare, adjustment: charge - allowed });
      }
      const patientPays = patientShare > 0 && random.int(1, 10) <= 7;
      if (patientPays) {
        postings.push({ month: m + lag + random.int(0, 2), payment: patientShare, adjustment: 0 });
      }
      // Many PM systems move the remaining patient share to self-pay once the payer has paid.
      const toPatientIn =
        payerClass !== "SELF" && patientShare > 0 && random.int(1, 2) === 1 ? m + lag : undefined;
      charges.push({ month: m, line: base, charge, postings, toPatientIn });
    }
  }

  const files: SyntheticMonth[] = [];
  for (let m = 0; m < options.months; m++) {
    const { year, month } = monthOf(start.year, start.month, m);
    const lines: MonthlyLine[] = [];
    for (const c of charges) {
      if (c.month > m) continue;
      const now = c.postings.filter((p) => p.month === m);
      const toDate = c.postings.filter((p) => p.month <= m);
      const balance = c.charge - toDate.reduce((t, p) => t + p.payment + p.adjustment, 0);
      if (c.month !== m && now.length === 0 && balance === 0) continue;
      const toPatient = c.toPatientIn !== undefined && m >= c.toPatientIn;
      lines.push({
        ...c.line,
        ...(toPatient ? { payerClass: "SELF", payerName: "Self-pay" } : {}),
        status:
          c.line.status ||
          (c.voidedIn !== undefined && m >= c.voidedIn ? "VOID" : balance === 0 ? "PAID" : "OPEN"),
        rowNumber: lines.length + 2,
        billedCents: c.month === m ? c.charge : 0,
        paymentCents: now.reduce((t, p) => t + p.payment, 0),
        adjustmentCents: now.reduce((t, p) => t + p.adjustment, 0),
        balanceCents: balance,
      });
    }
    files.push({ periodYear: year, periodMonth: month, lines });
  }
  return files;
}

/** One month's activity file (the last month of a short simulation), for samples and tests. */
export function generateMonthlyLines(options: {
  seed: number;
  periodYear: number;
  periodMonth: number;
  facilities: string[];
  lines?: number;
}): MonthlyLine[] {
  return generateMonthlyFiles({
    seed: options.seed,
    periodYear: options.periodYear,
    periodMonth: options.periodMonth,
    months: 4,
    facilities: options.facilities,
    chargesPerMonth: options.lines ?? 120,
  }).at(-1)!.lines;
}

const money = (cents: number) => (cents / 100).toFixed(2);
const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

export function monthlyLinesToCsv(lines: MonthlyLine[]): string {
  const body = lines.map((l) =>
    [
      l.patientName,
      l.accountNumber,
      usDate(l.serviceDate),
      l.cpt,
      l.description,
      l.facility,
      l.payerName,
      l.payerClass,
      l.status,
      money(l.billedCents),
      money(l.paymentCents),
      money(l.adjustmentCents),
      money(l.balanceCents),
    ]
      .map(csvCell)
      .join(","),
  );
  return [MONTHLY_FILE_HEADER.join(","), ...body].join("\r\n") + "\r\n";
}

/**
 * Synthetic bank deposits for months of posted payments: each month's payments arrive in a
 * handful of deposits during the month, except a small share that clears in the first days of
 * the next month (the usual deposit lag). The last month's lagged share is still in transit.
 */
export function depositsForPayments(
  months: Array<{ periodYear: number; periodMonth: number; paymentsCents: number }>,
  seed: number,
): Array<{ depositDate: string; amountCents: number }> {
  const random = createRandom(seed);
  const deposits: Array<{ depositDate: string; amountCents: number }> = [];
  months.forEach((m, i) => {
    const lagged = Math.round((m.paymentsCents * random.int(3, 12)) / 100);
    const days = new Date(Date.UTC(m.periodYear, m.periodMonth, 0)).getUTCDate();
    const count = 6;
    let left = m.paymentsCents - lagged;
    for (let d = 0; d < count; d++) {
      const amount = d === count - 1 ? left : Math.round((m.paymentsCents - lagged) / count);
      left -= amount;
      const day = Math.min(days, Math.round(((d + 1) * days) / count));
      if (amount !== 0)
        deposits.push({
          depositDate: `${m.periodYear}-${pad(m.periodMonth)}-${pad(day)}`,
          amountCents: amount,
        });
    }
    const next = months[i + 1];
    if (next && lagged !== 0) {
      deposits.push({
        depositDate: `${next.periodYear}-${pad(next.periodMonth)}-0${random.int(1, 4)}`,
        amountCents: lagged,
      });
    }
  });
  return deposits;
}

/** Synthetic deposits for simulated activity files. */
export function generateDeposits(files: SyntheticMonth[], seed: number) {
  return depositsForPayments(
    files.map((f) => ({
      periodYear: f.periodYear,
      periodMonth: f.periodMonth,
      paymentsCents: f.lines.reduce((t, l) => t + l.paymentCents, 0),
    })),
    seed,
  );
}

/** Deposits as a bank-style CSV (date and amount only). */
export function depositsToCsv(deposits: Array<{ depositDate: string; amountCents: number }>): string {
  const body = deposits.map((d) => [usDate(d.depositDate), money(d.amountCents)].map(csvCell).join(","));
  return ["Date,Amount", ...body].join("\r\n") + "\r\n";
}
