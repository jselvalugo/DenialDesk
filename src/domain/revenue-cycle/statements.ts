/**
 * Financial statements and dashboard figures (docs/specs/revenue-cycle-accounting.md, B5). Pure
 * builders over totals already routed to GL accounts; integer cents throughout.
 */

export interface MonthKey {
  periodYear: number;
  periodMonth: number;
}

export const monthKey = (m: MonthKey) => `${m.periodYear}-${String(m.periodMonth).padStart(2, "0")}`;

export interface AccountTotal extends MonthKey {
  account: string;
  cents: number;
}

export interface StatementRow {
  account: string;
  name: string;
  byMonth: number[];
  totalCents: number;
}

export interface IncomeStatement {
  months: MonthKey[];
  revenue: StatementRow[];
  deductions: StatementRow[];
  grossCents: number[];
  deductionCents: number[];
  netCents: number[];
}

function rows(totals: AccountTotal[], months: MonthKey[], names: Map<string, string>): StatementRow[] {
  const index = new Map(months.map((m, i) => [monthKey(m), i]));
  const byAccount = new Map<string, number[]>();
  for (const t of totals) {
    const i = index.get(monthKey(t));
    if (i === undefined || t.cents === 0) continue;
    const series = byAccount.get(t.account) ?? months.map(() => 0);
    series[i]! += t.cents;
    byAccount.set(t.account, series);
  }
  return [...byAccount.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([account, byMonth]) => ({
      account,
      name: names.get(account) ?? "Not in the chart of accounts",
      byMonth,
      totalCents: byMonth.reduce((a, b) => a + b, 0),
    }));
}

/**
 * Charges by revenue account less adjustments and write-offs by adjustment account, per month:
 * net patient service revenue plus any other revenue the rules route (e.g. interest income).
 */
export function incomeStatement(
  months: MonthKey[],
  charges: AccountTotal[],
  adjustments: AccountTotal[],
  names: Map<string, string>,
): IncomeStatement {
  const revenue = rows(charges, months, names);
  const deductions = rows(adjustments, months, names);
  const column = (list: StatementRow[]) => months.map((_, i) => list.reduce((t, r) => t + r.byMonth[i]!, 0));
  const grossCents = column(revenue);
  const deductionCents = column(deductions);
  return {
    months,
    revenue,
    deductions,
    grossCents,
    deductionCents,
    netCents: grossCents.map((g, i) => g - deductionCents[i]!),
  };
}

export interface MonthActivity extends MonthKey {
  netRevenueCents: number;
  paymentsCents: number;
}

const daysIn = (m: MonthKey) => new Date(Date.UTC(m.periodYear, m.periodMonth, 0)).getUTCDate();
const monthIndex = (m: MonthKey) => m.periodYear * 12 + m.periodMonth - 1;

/** Months the trailing ratios cover: the latest and the two calendar months before it. */
export const TRAILING_MONTHS = 3;

export interface Kpis {
  latest: MonthKey;
  netRevenueCents: number;
  paymentsCents: number;
  openArCents: number;
  /** Open A/R ÷ average daily net revenue over the trailing months; null without revenue. */
  daysInAr: number | null;
  /** Payments ÷ net revenue over the trailing months, in basis points; null without revenue. */
  netCollectionBps: number | null;
  /** How many months with files the trailing figures cover (up to 3; fewer after a gap). */
  trailingMonths: number;
}

/**
 * Headline figures for the latest month. `openArCents` is the latest month's open A/R (credit
 * balances excluded, as on the aging page). Trailing ratios cover the months with files among the
 * latest and the two calendar months before it; a missing month is left out, not bridged.
 */
export function kpis(months: MonthActivity[], openArCents: number): Kpis | null {
  if (months.length === 0) return null;
  const sorted = [...months].sort((a, b) => monthIndex(a) - monthIndex(b));
  const latest = sorted.at(-1)!;
  const trailing = sorted.filter((m) => monthIndex(latest) - monthIndex(m) < TRAILING_MONTHS);
  const revenue = trailing.reduce((t, m) => t + m.netRevenueCents, 0);
  const payments = trailing.reduce((t, m) => t + m.paymentsCents, 0);
  const days = trailing.reduce((t, m) => t + daysIn(m), 0);
  return {
    latest: { periodYear: latest.periodYear, periodMonth: latest.periodMonth },
    netRevenueCents: latest.netRevenueCents,
    paymentsCents: latest.paymentsCents,
    openArCents,
    daysInAr: revenue > 0 ? Math.round(((openArCents * days) / revenue) * 10) / 10 : null,
    netCollectionBps: revenue > 0 ? Math.round((payments * 10_000) / revenue) : null,
    trailingMonths: trailing.length,
  };
}

export interface DenialsByRegime {
  /** Null when the payer is unverified (spec: payer-catalog P1); reported as "Unmapped". */
  regime: string | null;
  count: number;
  deniedCents: number;
}

export interface ClassDenials {
  payerClass: string;
  count: number;
  deniedCents: number;
}

/**
 * Open denied dollars by financial class, through the payers' regulatory regime. A regime no class
 * claims is reported as "Unmapped"; when several classes share a regime, the first by code gets it.
 */
export function denialsByClass(
  denials: DenialsByRegime[],
  classes: Array<{ code: string; regime: string | null }>,
): ClassDenials[] {
  const owner = new Map<string, string>();
  for (const c of [...classes].sort((a, b) => (a.code < b.code ? -1 : 1))) {
    if (c.regime && !owner.has(c.regime)) owner.set(c.regime, c.code);
  }
  const byClass = new Map<string, ClassDenials>();
  for (const d of denials) {
    const payerClass = (d.regime ? owner.get(d.regime) : undefined) ?? "Unmapped";
    const row = byClass.get(payerClass) ?? { payerClass, count: 0, deniedCents: 0 };
    row.count += d.count;
    row.deniedCents += d.deniedCents;
    byClass.set(payerClass, row);
  }
  return [...byClass.values()].sort((a, b) => b.deniedCents - a.deniedCents);
}
