import { csvCell } from "@/lib/csv/parse";
import { createRandom, FIRST_NAMES, LAST_NAMES } from "@/domain/synthetic/generator";
import { MONTHLY_FILE_HEADER, SYNTHETIC_ACCOUNT_PREFIX, type MonthlyLine } from "./monthly-file";

// Synthetic monthly practice-management export (R-15.1): fictional names, SYN- account numbers,
// and a mix of lines that exercises every default rule. Deterministic for a given seed.

const SERVICES: ReadonlyArray<readonly [string, string, number, number]> = [
  // CPT/HCPCS, description, billed $, weight
  ["99213", "Office visit, established, low", 145, 30],
  ["99214", "Office visit, established, moderate", 210, 22],
  ["99203", "Office visit, new, low", 190, 8],
  ["G0467", "FQHC visit, established", 180, 5],
  ["90471", "Immunization administration", 35, 5],
  ["90472", "Immunization administration, each additional", 25, 3],
  ["3074F", "Most recent systolic BP < 130", 0, 3],
  ["93000", "Electrocardiogram, complete", 60, 6],
  ["36415", "Routine venipuncture", 18, 8],
  ["9921", "Office visit (code keyed short)", 145, 1],
];

const CLASSES: ReadonlyArray<readonly [string, string, number]> = [
  ["COM", "Gulf Coast Mutual (synthetic)", 30],
  ["HMO", "Sunward HMO (synthetic)", 18],
  ["MCR", "Medicare Part B (synthetic)", 20],
  ["MCRMCF", "Keystone Advantage (synthetic)", 10],
  ["SPY", "Self-pay", 12],
  ["COPYC", "Cash program (synthetic)", 4],
  ["MCDMCC", "Medicaid managed care (synthetic)", 4],
];

export function generateMonthlyLines(options: {
  seed: number;
  periodYear: number;
  periodMonth: number;
  facilities: string[];
  lines?: number;
}): MonthlyLine[] {
  const random = createRandom(options.seed);
  const days = new Date(Date.UTC(options.periodYear, options.periodMonth, 0)).getUTCDate();
  const facilities = options.facilities.length > 0 ? options.facilities : ["Main clinic"];
  const count = options.lines ?? 150;
  const lines: MonthlyLine[] = [];
  for (let i = 0; i < count; i++) {
    const [cpt, description, dollars] = random.weighted(SERVICES.map((s) => [s, s[3]] as const));
    const [payerClass, payerName] = random.weighted(CLASSES.map((c) => [c, c[2]] as const));
    const billedCents = dollars * 100;
    const paid =
      payerClass === "SPY"
        ? random.int(0, 1) * billedCents
        : Math.round((billedCents * random.int(0, 80)) / 100);
    const special = random.int(1, 60);
    lines.push({
      rowNumber: i + 2,
      patientName: `${random.pick(LAST_NAMES)}, ${random.pick(FIRST_NAMES)}`,
      accountNumber: `${SYNTHETIC_ACCOUNT_PREFIX}${String(100_000 + random.int(0, 899_999))}`,
      serviceDate: `${options.periodYear}-${String(options.periodMonth).padStart(2, "0")}-${String(random.int(1, days)).padStart(2, "0")}`,
      cpt,
      description: special === 1 ? "Prompt-pay interest" : description,
      facility: special === 2 ? "Sala Comunitaria (synthetic)" : random.pick(facilities),
      payerName,
      payerClass,
      status: special === 3 ? "51CR" : special === 1 ? "INTEC" : paid > 0 ? "PAID" : "OPEN",
      billedCents,
      paymentCents: paid,
      balanceCents: billedCents - paid,
    });
  }
  return lines;
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
      money(l.balanceCents),
    ]
      .map(csvCell)
      .join(","),
  );
  return [MONTHLY_FILE_HEADER.join(","), ...body].join("\r\n") + "\r\n";
}
