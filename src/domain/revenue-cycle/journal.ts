import { csvCell } from "@/lib/csv/parse";
import { periodEnd } from "./monthly-file";

/**
 * Revenue-recognition journal vouchers (docs/specs/revenue-cycle-accounting.md, B3). Pure: builds
 * balanced lines from a file's classified totals, runs the five checks, and writes the general
 * ledger import CSV. Integer cents throughout; the checks are exact.
 */

/** Totals of one (site, AR, revenue, adjustment account) group of a monthly file. */
export interface VoucherGroup {
  siteCode: string;
  arGl: string;
  revenueGl: string;
  adjustmentGl: string;
  grossCents: number;
  adjustmentCents: number;
  paymentCents: number;
}

export type LineRole = "charges" | "adjustments" | "payments" | "reclass";

/** Open receivable by site and AR account, keyed by `balanceKey`. */
export type Balances = Map<string, number>;
export const balanceKey = (siteCode: string, arGl: string) => `${siteCode}|${arGl}`;

export interface VoucherLine {
  lineNumber: number;
  role: LineRole;
  account: string;
  siteCode: string;
  debitCents: number;
  creditCents: number;
  memo: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortPeriod = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;

export const voucherNumber = (year: number, month: number, version: number) =>
  `RCM-${year}-${String(month).padStart(2, "0")}-v${version}`;

/** Deterministic order: site, then AR, revenue, adjustment account. */
function compareGroups(a: VoucherGroup, b: VoucherGroup) {
  for (const key of ["siteCode", "arGl", "revenueGl", "adjustmentGl"] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  return 0;
}

/** Receivable movement per site and AR account: charges − adjustments − payments. */
export function arMovements(groups: VoucherGroup[]): Balances {
  const movements: Balances = new Map();
  for (const g of groups) {
    const key = balanceKey(g.siteCode, g.arGl);
    movements.set(key, (movements.get(key) ?? 0) + g.grossCents - g.adjustmentCents - g.paymentCents);
  }
  return movements;
}

/**
 * Two lines per movement: charges debit AR and credit revenue; adjustments and write-offs debit
 * the adjustment account and credit AR; payments debit the payments-clearing account and credit
 * AR. A negative amount (net reversals) swaps the sides. Zero amounts produce no lines.
 *
 * With the prior month's balances (`opening`), each site and AR account is then reclassified to
 * this month's file balances (`closing`): lines whose financial class or facility changed moved
 * their balance to another account or site. The reclassification lines net to zero whenever the
 * months roll forward; otherwise the voucher can't balance.
 */
export function buildVoucherLines(
  groups: VoucherGroup[],
  year: number,
  month: number,
  clearingAccount: string,
  balances?: { opening: Balances; closing: Balances },
): VoucherLine[] {
  const lines: VoucherLine[] = [];
  const period = shortPeriod(year, month);
  const post = (role: LineRole, debit: string, credit: string, site: string, cents: number, memo: string) => {
    if (cents === 0) return;
    const [dr, cr] = cents > 0 ? [debit, credit] : [credit, debit];
    const amount = Math.abs(cents);
    const base = { role, siteCode: site, memo: `${memo} ${period}, site ${site || "none"}` };
    lines.push({ ...base, lineNumber: lines.length + 1, account: dr, debitCents: amount, creditCents: 0 });
    lines.push({ ...base, lineNumber: lines.length + 1, account: cr, debitCents: 0, creditCents: amount });
  };
  for (const g of [...groups].sort(compareGroups)) {
    post("charges", g.arGl, g.revenueGl, g.siteCode, g.grossCents, "Patient charges");
    post("adjustments", g.adjustmentGl, g.arGl, g.siteCode, g.adjustmentCents, "Adjustments and write-offs");
    post("payments", clearingAccount, g.arGl, g.siteCode, g.paymentCents, "Patient payments");
  }
  if (balances) {
    const movements = arMovements(groups);
    const keys = [
      ...new Set([...balances.opening.keys(), ...balances.closing.keys(), ...movements.keys()]),
    ].sort();
    for (const key of keys) {
      const difference =
        (balances.closing.get(key) ?? 0) - (balances.opening.get(key) ?? 0) - (movements.get(key) ?? 0);
      if (difference === 0) continue;
      const [site, account] = key.split("|") as [string, string];
      lines.push({
        role: "reclass",
        lineNumber: lines.length + 1,
        account,
        siteCode: site,
        debitCents: Math.max(difference, 0),
        creditCents: Math.max(-difference, 0),
        memo: `Receivable reclassification ${period}, site ${site || "none"}`,
      });
    }
  }
  return lines;
}

export type AccountKind = "cash" | "ar" | "revenue" | "adjustment";

export interface CheckInput {
  lines: Pick<VoucherLine, "role" | "account" | "siteCode" | "debitCents" | "creditCents">[];
  /** The source file's totals. */
  source: { grossCents: number; adjustmentCents: number; paymentCents: number };
  /** The practice's chart of accounts. */
  accounts: Map<string, AccountKind>;
  /** Another approved or exported voucher for the same period. */
  otherPostedVoucher: string | null;
  /** Open receivables by site and AR account: the prior month's file (null if none) and this one's. */
  balances: { opening: Balances | null; closing: Balances };
}

export interface VoucherCheck {
  id: "balanced" | "ties_to_file" | "receivables_tie" | "accounts_valid" | "not_posted_twice";
  label: string;
  passed: boolean;
  detail: string;
}

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export function checkVoucher(input: CheckInput): VoucherCheck[] {
  const { lines, source, accounts } = input;
  const sum = (filter: (l: CheckInput["lines"][number]) => boolean, side: "debitCents" | "creditCents") =>
    lines.filter(filter).reduce((total, l) => total + l[side], 0);
  const all = () => true;
  const debits = sum(all, "debitCents");
  const credits = sum(all, "creditCents");
  const isAr = (l: CheckInput["lines"][number]) => accounts.get(l.account) === "ar";
  // Charges as posted to AR (debit − credit on charge lines), adjustments as taken off AR.
  const postedGross =
    sum((l) => l.role === "charges" && isAr(l), "debitCents") -
    sum((l) => l.role === "charges" && isAr(l), "creditCents");
  const takenOff = (role: LineRole) =>
    sum((l) => l.role === role && isAr(l), "creditCents") -
    sum((l) => l.role === role && isAr(l), "debitCents");
  const postedAdjustments = takenOff("adjustments");
  const postedPayments = takenOff("payments");
  // Receivables by site and account after this voucher, against the file's open balances.
  const { opening, closing } = input.balances;
  const untied: string[] = [];
  if (opening) {
    const after = new Map(opening);
    for (const l of lines.filter(isAr)) {
      const key = balanceKey(l.siteCode, l.account);
      after.set(key, (after.get(key) ?? 0) + l.debitCents - l.creditCents);
    }
    for (const key of new Set([...after.keys(), ...closing.keys()])) {
      if ((after.get(key) ?? 0) !== (closing.get(key) ?? 0)) untied.push(key.replace("|", " / "));
    }
  }

  const wrongAccounts = lines.filter((l) => {
    const kind = accounts.get(l.account);
    const allowed = {
      charges: ["ar", "revenue"],
      adjustments: ["ar", "adjustment"],
      payments: ["ar", "cash"],
      reclass: ["ar"],
    }[l.role];
    return !kind || !allowed.includes(kind);
  });
  // Each movement pair must touch AR exactly once, or charges could bypass receivables.
  const paired = lines.filter((l) => l.role !== "reclass");
  const arLines = paired.filter(isAr).length;
  const missingSite = lines.filter((l) => l.siteCode.trim() === "").length;

  return [
    {
      id: "balanced",
      label: "Debits equal credits",
      passed: debits === credits && lines.length > 0,
      detail:
        lines.length === 0
          ? "The voucher has no lines."
          : debits === credits
            ? `Debits ${money(debits)}, credits ${money(credits)}.`
            : `Debits ${money(debits)}, credits ${money(credits)}. The file doesn't roll forward from last month's: check that the export includes every open line.`,
    },
    {
      id: "ties_to_file",
      label: "Ties to the source file",
      passed:
        postedGross === source.grossCents &&
        postedAdjustments === source.adjustmentCents &&
        postedPayments === source.paymentCents,
      detail: `Charges ${money(postedGross)} of ${money(source.grossCents)}; adjustments ${money(postedAdjustments)} of ${money(source.adjustmentCents)}; payments ${money(postedPayments)} of ${money(source.paymentCents)}.`,
    },
    {
      id: "receivables_tie",
      label: "Receivables tie to the file by account and site",
      passed: untied.length === 0,
      detail: !opening
        ? "First imported month: opening receivables come from your general ledger."
        : untied.length > 0
          ? `Don't match the file's open balances: ${untied.slice(0, 5).join(", ")}${untied.length > 5 ? ", …" : ""}.`
          : "Opening balances plus this month's movements equal the file's open balances.",
    },
    {
      id: "accounts_valid",
      label: "Accounts and sites are valid",
      passed: wrongAccounts.length === 0 && missingSite === 0 && arLines * 2 === paired.length,
      detail:
        wrongAccounts.length > 0
          ? `Not in the chart or the wrong type: ${[...new Set(wrongAccounts.map((l) => l.account))].join(", ")}.`
          : missingSite > 0
            ? `${missingSite} lines have no site. Set a default site and re-import the file.`
            : arLines * 2 !== paired.length
              ? "Every movement must post to exactly one receivable account."
              : "Every account is in the chart with the right type, and every line has a site.",
    },
    {
      id: "not_posted_twice",
      label: "Period not already posted",
      passed: input.otherPostedVoucher === null,
      detail: input.otherPostedVoucher
        ? `Voucher ${input.otherPostedVoucher} is already approved for this period. Void it first.`
        : "No other approved or exported voucher covers this period.",
    },
  ];
}

export const allPassed = (checks: VoucherCheck[]) => checks.every((c) => c.passed);

export const GL_CSV_HEADER = ["Journal", "Date", "Account", "Site", "Debit", "Credit", "Memo"];

const amount = (cents: number) => (cents === 0 ? "" : (cents / 100).toFixed(2));

/** General-ledger import CSV, dated the last day of the period. Formula-safe cells. */
export function voucherCsv(
  voucher: { number: string; periodYear: number; periodMonth: number },
  lines: Pick<VoucherLine, "account" | "siteCode" | "debitCents" | "creditCents" | "memo">[],
): string {
  const date = periodEnd(voucher.periodYear, voucher.periodMonth);
  const rows = lines.map((l) =>
    [voucher.number, date, l.account, l.siteCode, amount(l.debitCents), amount(l.creditCents), l.memo]
      .map(csvCell)
      .join(","),
  );
  return [GL_CSV_HEADER.join(","), ...rows].join("\r\n") + "\r\n";
}
