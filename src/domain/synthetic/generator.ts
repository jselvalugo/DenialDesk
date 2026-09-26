import type { Regime } from "@rules/types";
import { addCalendarDays } from "@rules/calendar";
import { CARC, categorize, type DenialCategory } from "@/domain/carc";
import type { DenialStatus } from "@/domain/denial-status";

// Deterministic synthetic data (R-15.1). Every identifier carries a SYN marker; names come from
// short fictional lists; no real person, practice, or payer. Dates are relative to `asOf` so the
// demo always has current deadlines.

export const SYNTHETIC_MARKER = "SYN";

/** mulberry32: small, fast, seedable PRNG so the same seed always yields the same data. */
export function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const weighted = <T>(items: ReadonlyArray<readonly [T, number]>): T => {
    const total = items.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = next() * total;
    for (const [item, weight] of items) {
      roll -= weight;
      if (roll < 0) return item;
    }
    return items[items.length - 1]![0];
  };
  return { next, int, pick, weighted };
}

/** NPI check digit: Luhn over "80840" + the first 9 digits (CMS NPI standard). */
export function npiCheckDigit(first9: string): number {
  const digits = `80840${first9}`.split("").map(Number);
  let sum = 0;
  for (let i = digits.length - 1, double = true; i >= 0; i--, double = !double) {
    let d = digits[i]!;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidNpi(npi: string): boolean {
  return /^\d{10}$/.test(npi) && npiCheckDigit(npi.slice(0, 9)) === Number(npi[9]);
}

export const FIRST_NAMES = [
  "Avery",
  "Jordan",
  "Riley",
  "Morgan",
  "Casey",
  "Quinn",
  "Reese",
  "Harper",
  "Rowan",
  "Emerson",
  "Sage",
  "Parker",
  "Dakota",
  "Hayden",
  "Kendall",
  "Marlow",
] as const;
export const LAST_NAMES = [
  "Castellan",
  "Brightwater",
  "Fenwick",
  "Oakridge",
  "Delacroix",
  "Marchetti",
  "Whitlock",
  "Ashby",
  "Calloway",
  "Duquesne",
  "Holloway",
  "Lindqvist",
  "Ravensworth",
  "Thistle",
  "Vanterpool",
  "Winslow",
] as const;

export interface SyntheticPayer {
  key: string;
  name: string;
  ediPayerId: string;
  regime: Regime;
  appealWindowDays: number | null;
  appealWindowSource: string | null;
}

// Fictional payers. Appeal windows here stand in for contract terms a practice would configure.
export const SYNTHETIC_PAYERS: SyntheticPayer[] = [
  {
    key: "gulf",
    name: "Gulf Coast Mutual",
    ediPayerId: "SYN01",
    regime: "fl_insurer",
    appealWindowDays: 90,
    appealWindowSource: "Synthetic contract §7.2",
  },
  {
    key: "sunward",
    name: "Sunward HMO",
    ediPayerId: "SYN02",
    regime: "fl_hmo",
    appealWindowDays: 60,
    appealWindowSource: "Synthetic contract §5.1",
  },
  {
    key: "medicare",
    name: "Medicare Part B (synthetic)",
    ediPayerId: "SYN03",
    regime: "medicare",
    appealWindowDays: null,
    appealWindowSource: null,
  },
  {
    key: "keystone",
    name: "Keystone Advantage",
    ediPayerId: "SYN04",
    regime: "medicare_advantage",
    appealWindowDays: 60,
    appealWindowSource: "Synthetic plan agreement",
  },
  {
    key: "harbor",
    name: "Harborline Health Plan",
    ediPayerId: "SYN05",
    regime: "erisa_self_funded",
    appealWindowDays: null,
    appealWindowSource: null,
  },
];

// Common procedure codes, numbers only (no AMA descriptors are shipped), with synthetic charges.
const PROCEDURES: ReadonlyArray<readonly [string, number]> = [
  ["99213", 14_500],
  ["99214", 21_000],
  ["99204", 32_500],
  ["93000", 6_800],
  ["36415", 1_500],
  ["71046", 9_800],
  ["20610", 22_000],
  ["97110", 7_200],
];
const DIAGNOSES = ["E11.9", "I10", "M17.11", "J06.9", "R07.9", "Z00.00", "M54.50", "E78.5"] as const;

const DENIAL_CODES: ReadonlyArray<readonly [string, number]> = [
  ["197", 5],
  ["16", 5],
  ["50", 4],
  ["97", 3],
  ["29", 2],
  ["18", 2],
  ["27", 2],
  ["11", 2],
  ["22", 1],
  ["252", 2],
];
const RARCS: Record<string, string[]> = { "16": ["N290"], "252": ["N706"], "50": ["N115"], "197": ["N54"] };

export interface SyntheticDataset {
  asOf: string;
  locations: Array<{ key: string; name: string; city: string }>;
  providers: Array<{ key: string; name: string; npi: string; taxonomy: string; flLicense: string }>;
  payers: SyntheticPayer[];
  patients: Array<{
    key: string;
    mrn: string;
    firstName: string;
    lastName: string;
    birthDate: string;
    memberId: string;
  }>;
  claims: Array<{
    key: string;
    claimNumber: string;
    patientKey: string;
    providerKey: string;
    locationKey: string;
    payerKey: string;
    serviceDate: string;
    diagnosisCodes: string[];
    electronic: boolean;
    payerReceivedDate: string;
    lines: Array<{ procedureCode: string; units: number; chargeCents: number }>;
    denial: null | {
      groupCode: "CO" | "PR" | "OA";
      carc: string;
      rarcs: string[];
      category: DenialCategory;
      lineIndex: number | null;
      deniedCents: number;
      noticeDate: string;
      status: DenialStatus;
    };
  }>;
}

export function generateDataset(options: {
  asOf: string;
  seed?: number;
  patients?: number;
  claims?: number;
}): SyntheticDataset {
  const random = createRandom(options.seed ?? 20260926);
  const { asOf } = options;

  const locations = [
    { key: "tampa", name: "Bayshore Internal Medicine", city: "Tampa" },
    { key: "orlando", name: "Lake Eola Family Care", city: "Orlando" },
  ];

  const providers = [
    "Dr. Avery Castellan",
    "Dr. Jordan Whitlock",
    "Dr. Riley Lindqvist",
    "Dr. Sage Holloway",
  ].map((name, i) => {
    const first9 = `1${String(random.int(10_000_000, 99_999_999))}`;
    return {
      key: `prov${i}`,
      name: `${name} (synthetic)`,
      npi: `${first9}${npiCheckDigit(first9)}`,
      taxonomy: i % 2 === 0 ? "207R00000X" : "207Q00000X",
      flLicense: `SYN${String(random.int(10_000, 99_999))}`,
    };
  });

  const patients = Array.from({ length: options.patients ?? 80 }, (_, i) => ({
    key: `pt${i}`,
    mrn: `${SYNTHETIC_MARKER}-${String(1000 + i).padStart(6, "0")}`,
    firstName: random.pick(FIRST_NAMES),
    lastName: random.pick(LAST_NAMES),
    birthDate: addCalendarDays("1950-01-01", random.int(0, 365 * 55)),
    memberId: `${SYNTHETIC_MARKER}${String(random.int(100_000_000, 999_999_999))}`,
  }));

  const claims: SyntheticDataset["claims"] = [];
  for (let i = 0; i < (options.claims ?? 180); i++) {
    const payer = random.weighted(SYNTHETIC_PAYERS.map((p, idx) => [p, [4, 3, 3, 2, 1][idx]!] as const));
    const serviceDate = addCalendarDays(asOf, -random.int(20, 200));
    const received = addCalendarDays(serviceDate, random.int(2, 12));
    const lineCount = random.weighted([
      [1, 5],
      [2, 3],
      [3, 1],
    ] as const);
    const lines = Array.from({ length: lineCount }, () => {
      const [procedureCode, charge] = random.pick(PROCEDURES);
      const units = procedureCode === "97110" ? random.int(1, 4) : 1;
      return { procedureCode, units, chargeCents: charge * units };
    });
    const billed = lines.reduce((sum, line) => sum + line.chargeCents, 0);

    let denial: SyntheticDataset["claims"][number]["denial"] = null;
    if (random.next() < 0.45) {
      const carc = random.weighted(DENIAL_CODES);
      const lineIndex = lines.length > 1 && random.next() < 0.5 ? random.int(0, lines.length - 1) : null;
      const base = lineIndex === null ? billed : lines[lineIndex]!.chargeCents;
      const noticeDate = addCalendarDays(received, random.int(15, 45));
      if (noticeDate <= asOf) {
        const age = Math.round((Date.parse(asOf) - Date.parse(noticeDate)) / 86_400_000);
        const status: DenialStatus =
          age < 14
            ? random.weighted([
                ["new", 6],
                ["in_review", 2],
              ] as const)
            : age > 75
              ? // Older denials are mostly worked or resolved; only a few slip past the deadline.
                random.weighted([
                  ["appeal_submitted", 3],
                  ["overturned", 4],
                  ["upheld", 2],
                  ["written_off", 2],
                  ["needs_records", 1],
                ] as const)
              : random.weighted([
                  ["new", 2],
                  ["in_review", 3],
                  ["needs_records", 2],
                  ["appeal_drafted", 2],
                  ["appeal_submitted", 2],
                  ["overturned", 2],
                  ["upheld", 1],
                  ["written_off", 1],
                ] as const);
        denial = {
          groupCode: carc === "22" ? "OA" : "CO",
          carc,
          rarcs: RARCS[carc] ?? [],
          category: categorize(carc),
          lineIndex,
          deniedCents: carc === "97" ? Math.round(base * 0.6) : base,
          noticeDate,
          status,
        };
      }
    }

    claims.push({
      key: `clm${i}`,
      claimNumber: `CLM-${SYNTHETIC_MARKER}-${String(10_000 + i)}`,
      patientKey: random.pick(patients).key,
      providerKey: random.pick(providers).key,
      locationKey: random.pick(locations).key,
      payerKey: payer.key,
      serviceDate,
      diagnosisCodes: [random.pick(DIAGNOSES)],
      electronic: random.next() < 0.9,
      payerReceivedDate: received,
      lines,
      denial,
    });
  }

  return { asOf, locations, providers, payers: SYNTHETIC_PAYERS, patients, claims };
}

/** Every CARC the generator can emit must exist in the reference (guards against invented codes). */
export const GENERATED_CARCS = DENIAL_CODES.map(([code]) => code).filter((code) => code in CARC);
