import { csvCell } from "@/lib/csv/parse";
import type { MessageKey } from "@/i18n/messages/types";
import { formatCents } from "@/lib/format";
import { englishRevenue, type RevenueT } from "./i18n";
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
export const balanceKey = (siteCode: string, arGl: string) => JSON.stringify([siteCode, arGl]);
const parseKey = (key: string) => JSON.parse(key) as [string, string];

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
      const [site, account] = parseKey(key);
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
  /**
   * Open receivables by site and AR account: the prior month's file and this one's. `opening` is
   * null for the practice's first imported month; `missingPrior` names a prior month that has no
   * current-format file although earlier months do (a gap).
   */
  balances: { opening: Balances | null; closing: Balances; missingPrior?: string | null };
}

export type VoucherCheckId =
  "balanced" | "ties_to_file" | "receivables_tie" | "accounts_valid" | "not_posted_twice";

export interface VoucherCheck {
  id: VoucherCheckId;
  passed: boolean;
  detail: string;
}

/** The check's name, for the UI: `t(VOUCHER_CHECK_LABEL_KEYS[c.id])`. `detail` is already translated. */
export const VOUCHER_CHECK_LABEL_KEYS = {
  balanced: "voucher.check.balanced",
  ties_to_file: "voucher.check.tiesToFile",
  receivables_tie: "voucher.check.receivablesTie",
  accounts_valid: "voucher.check.accountsValid",
  not_posted_twice: "voucher.check.notPostedTwice",
} as const satisfies Record<VoucherCheckId, MessageKey<"revenue">>;

const money = formatCents;

export function checkVoucher(input: CheckInput, t: RevenueT = englishRevenue): VoucherCheck[] {
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
      if ((after.get(key) ?? 0) !== (closing.get(key) ?? 0)) untied.push(parseKey(key).join(" / "));
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
  // Each movement pair (two consecutive lines of one role) must touch AR exactly once, or
  // charges could bypass receivables.
  const paired = lines.filter((l) => l.role !== "reclass");
  let badPairs = paired.length % 2;
  for (let i = 0; i + 1 < paired.length; i += 2) {
    const [x, y] = [paired[i]!, paired[i + 1]!];
    if (x.role !== y.role || Number(isAr(x)) + Number(isAr(y)) !== 1) badPairs += 1;
  }
  const missingSite = lines.filter((l) => l.siteCode.trim() === "").length;

  return [
    {
      id: "balanced",
      passed: debits === credits && lines.length > 0,
      detail:
        lines.length === 0
          ? t("voucher.detail.noLines")
          : debits === credits
            ? t("voucher.detail.balanced", { debits: money(debits), credits: money(credits) })
            : t("voucher.detail.unbalanced", { debits: money(debits), credits: money(credits) }),
    },
    {
      id: "ties_to_file",
      passed:
        postedGross === source.grossCents &&
        postedAdjustments === source.adjustmentCents &&
        postedPayments === source.paymentCents,
      detail: t("voucher.detail.tiesToFile", {
        charges: money(postedGross),
        chargesTotal: money(source.grossCents),
        adjustments: money(postedAdjustments),
        adjustmentsTotal: money(source.adjustmentCents),
        payments: money(postedPayments),
        paymentsTotal: money(source.paymentCents),
      }),
    },
    {
      id: "receivables_tie",
      passed: untied.length === 0 && !input.balances.missingPrior,
      detail: input.balances.missingPrior
        ? t("voucher.detail.missingPrior", { period: input.balances.missingPrior })
        : !opening
          ? t("voucher.detail.firstMonth")
          : untied.length > 0
            ? t("voucher.detail.untied", {
                list: untied.slice(0, 5).join(", ") + (untied.length > 5 ? ", …" : ""),
              })
            : t("voucher.detail.tied"),
    },
    {
      id: "accounts_valid",
      passed: wrongAccounts.length === 0 && missingSite === 0 && badPairs === 0,
      detail:
        wrongAccounts.length > 0
          ? t("voucher.detail.wrongAccounts", {
              accounts: [...new Set(wrongAccounts.map((l) => l.account))].join(", "),
            })
          : missingSite > 0
            ? t("voucher.detail.missingSite", { count: missingSite })
            : badPairs > 0
              ? t("voucher.detail.badPairs")
              : t("voucher.detail.accountsValid"),
    },
    {
      id: "not_posted_twice",
      passed: input.otherPostedVoucher === null,
      detail: input.otherPostedVoucher
        ? t("voucher.detail.alreadyPosted", { number: input.otherPostedVoucher })
        : t("voucher.detail.notPosted"),
    },
  ];
}

export const allPassed = (checks: VoucherCheck[]) => checks.every((c) => c.passed);

export const GL_CSV_HEADER = ["Journal", "Date", "Account", "Site", "Debit", "Credit", "Memo"];

/** Non-negative cents as "1234.56" with integer arithmetic only. */
const amount = (cents: number) =>
  cents === 0 ? "" : `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

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
