import { SANDBOX_BASE_URL, SANDBOX_MRN_SYSTEM } from "../url-rules";

// The built-in synthetic FHIR dataset (docs/specs/patient-integrations.md PI2b "Synthetic sandbox").
// Deterministic, Synthea-style synthetic patients: names carry numeric suffixes like Synthea's
// ("Marisol412"), every MRN and member ID starts with `SYN-`, and every resource carries a synthetic
// `meta.tag`. No real person, address, or identifier is used or imitated: the cities are Florida
// cities, the street numbers and ZIP codes are made up, and the phone numbers are in the reserved
// 555-01xx fiction range. Nothing here is random at run time (a seeded PRNG), so the same tests and the
// same demo produce the same patients.
//
// The first patients are fixtures for every mapping rule; the rest are ordinary.

export const SANDBOX_SYNTHETIC_TAG = {
  system: "https://sandbox.fhir.denialdesk.invalid/CodeSystem/synthetic",
  code: "synthetic",
  display: "Synthetic test data",
} as const;

/** Enough for two pages at `_count=100` (spec: "multi-page"). */
export const SANDBOX_PATIENT_COUNT = 125;
/** Every resource's `meta.lastUpdated` is this plus one minute per patient: long before any run. */
export const SANDBOX_EPOCH = new Date("2025-01-01T00:00:00.000Z");
const V2_0203 = "http://terminology.hl7.org/CodeSystem/v2-0203";
const SUBSCRIBER_RELATIONSHIP = "http://terminology.hl7.org/CodeSystem/subscriber-relationship";
const CONFIDENTIALITY = "http://terminology.hl7.org/CodeSystem/v3-Confidentiality";
const ACT_CODE = "http://terminology.hl7.org/CodeSystem/v3-ActCode";

export const SANDBOX_ORGANIZATIONS = [
  { id: "syn-org-1", name: "Synthetic Health Plan A" },
  { id: "syn-org-2", name: "Synthetic Health Plan B" },
  { id: "syn-org-3", name: "Synthetic Health Plan C" },
  { id: "syn-org-9", name: "Synthetic Unlisted Plan" },
] as const;

/**
 * Which patient (1-based) is which fixture. Exported so tests name them, not count them.
 * `normal` patients are every other number.
 */
export const SANDBOX_FIXTURES = {
  inactive: 2,
  replacedBy: 3,
  partialBirthDate: 4,
  dependentCoverage: 5,
  unmappedPayor: 6,
  nonOrganizationPayor: 7,
  restrictedLabel: 8,
  hivLabel: 9,
  unknownLabel: 10,
  minor: 11,
  ssnShapedMrn: 12,
  noCoverage: 13,
  secondaryCoverage: 14,
} as const;

/** Patients a full sync stores (every patient but the two that a required rule skips). */
export const SANDBOX_SKIPPED_FIXTURES = [
  SANDBOX_FIXTURES.partialBirthDate,
  SANDBOX_FIXTURES.ssnShapedMrn,
] as const;

const FIRST_NAMES = [
  "Marisol",
  "Tobias",
  "Anneliese",
  "Quentin",
  "Priya",
  "Lorenzo",
  "Imani",
  "Desmond",
  "Wren",
  "Casimir",
  "Odalys",
  "Bertrand",
  "Yasmin",
  "Everett",
  "Noor",
  "Thaddeus",
];
const LAST_NAMES = [
  "Abernathy",
  "Blackwood",
  "Castellanos",
  "Dunmore",
  "Eastwick",
  "Fairbairn",
  "Grimaldi",
  "Hollander",
  "Ironside",
  "Jorgensen",
  "Kettleby",
  "Lindqvist",
  "Montrose",
  "Northcott",
  "Oakhurst",
  "Pemberton",
];
const CITIES: readonly [string, string][] = [
  ["Tampa", "336"],
  ["Orlando", "328"],
  ["Gainesville", "326"],
  ["Tallahassee", "323"],
  ["Sarasota", "342"],
];
const STREETS = ["Palm Way", "Heron Court", "Seagrass Lane", "Mangrove Drive", "Coquina Road"];

/** mulberry32: a tiny seeded PRNG, so the dataset is identical on every run. */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type FhirJson = Record<string, unknown>;

export interface SandboxPatient {
  id: string;
  lastUpdated: Date;
  resource: FhirJson;
  coverages: FhirJson[];
}

const pad = (n: number, width = 4) => String(n).padStart(width, "0");
export const sandboxPatientId = (n: number) => `syn-pat-${pad(n)}`;
export const sandboxMrn = (n: number) => `SYN-${pad(n, 7)}`;
export const sandboxMemberId = (n: number) => `SYN-MBR-${pad(n, 7)}`;

function coverage(n: number, patientId: string, lastUpdated: Date, overrides: FhirJson = {}): FhirJson {
  const org = SANDBOX_ORGANIZATIONS[(n - 1) % 3]!;
  return {
    resourceType: "Coverage",
    id: `syn-cov-${pad(n)}`,
    meta: { versionId: "1", lastUpdated: lastUpdated.toISOString(), tag: [SANDBOX_SYNTHETIC_TAG] },
    status: "active",
    identifier: [
      {
        type: { coding: [{ system: V2_0203, code: "MB" }] },
        system: `${SANDBOX_BASE_URL}/member`,
        value: sandboxMemberId(n),
      },
    ],
    subscriberId: sandboxMemberId(n),
    beneficiary: { reference: `Patient/${patientId}` },
    relationship: { coding: [{ system: SUBSCRIBER_RELATIONSHIP, code: "self" }] },
    period: { start: "2020-01-01" },
    order: 1,
    payor: [{ reference: `Organization/${org.id}`, display: org.name }],
    ...overrides,
  };
}

/**
 * The minor fixture's birth date, relative to `now` so the fixture stays a minor (about ten) however long
 * the code lives: ten years before the current year, 1 March. Not part of the seeded random sequence.
 */
export const sandboxMinorBirthDate = (now: Date): string => `${now.getUTCFullYear() - 10}-03-01`;

function buildPatient(n: number, random: () => number, now: Date): SandboxPatient {
  const id = sandboxPatientId(n);
  const lastUpdated = new Date(SANDBOX_EPOCH.getTime() + n * 60_000);
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
  const [city, zipPrefix] = pick(CITIES);
  const year = 1938 + Math.floor(random() * 62);
  const month = 1 + Math.floor(random() * 12);
  const day = 1 + Math.floor(random() * 28);
  const F = SANDBOX_FIXTURES;

  const resource: FhirJson = {
    resourceType: "Patient",
    id,
    meta: { versionId: "1", lastUpdated: lastUpdated.toISOString(), tag: [SANDBOX_SYNTHETIC_TAG] },
    identifier: [
      {
        type: { coding: [{ system: V2_0203, code: "MR" }] },
        system: SANDBOX_MRN_SYSTEM,
        value: n === F.ssnShapedMrn ? "SYN-123-45-6789" : sandboxMrn(n),
      },
    ],
    active: n !== F.inactive,
    name: [
      {
        use: "official",
        family: `${pick(LAST_NAMES)}${100 + Math.floor(random() * 900)}`,
        given: [`${pick(FIRST_NAMES)}${100 + Math.floor(random() * 900)}`],
      },
    ],
    gender: pick(["female", "male", "other", "unknown"] as const),
    birthDate:
      n === F.partialBirthDate
        ? "1985-04"
        : n === F.minor
          ? sandboxMinorBirthDate(now)
          : `${year}-${pad(month, 2)}-${pad(day, 2)}`,
    address: [
      {
        use: "home",
        line: [`${100 + Math.floor(random() * 8900)} ${pick(STREETS)}`],
        city,
        state: "FL",
        postalCode: `${zipPrefix}${pad(Math.floor(random() * 100), 2)}`,
      },
    ],
    // Fields the sync must never read (minimum necessary, threat model I2): present so tests prove it.
    telecom: [{ system: "phone", value: `555-01${pad(n % 100, 2)}` }],
    maritalStatus: { text: "Synthetic" },
  };
  const security: FhirJson[] = [];
  if (n === F.restrictedLabel) security.push({ system: CONFIDENTIALITY, code: "R" });
  if (n === F.hivLabel) security.push({ system: ACT_CODE, code: "HIV" });
  if (n === F.unknownLabel)
    security.push({
      system: "https://sandbox.fhir.denialdesk.invalid/CodeSystem/label",
      code: "X-SYNTHETIC",
    });
  if (security.length > 0) (resource.meta as FhirJson).security = security;
  if (n === F.replacedBy)
    resource.link = [{ type: "replaced-by", other: { reference: `Patient/${sandboxPatientId(1)}` } }];

  let coverages: FhirJson[] = [coverage(n, id, lastUpdated)];
  if (n === F.dependentCoverage) {
    coverages = [
      coverage(n, id, lastUpdated, {
        relationship: { coding: [{ system: SUBSCRIBER_RELATIONSHIP, code: "child" }] },
      }),
    ];
  } else if (n === F.unmappedPayor) {
    coverages = [
      coverage(n, id, lastUpdated, {
        payor: [{ reference: "Organization/syn-org-9", display: "Synthetic Unlisted Plan" }],
      }),
    ];
  } else if (n === F.nonOrganizationPayor) {
    coverages = [coverage(n, id, lastUpdated, { payor: [{ reference: `Patient/${id}` }] })];
  } else if (n === F.noCoverage) {
    coverages = [];
  } else if (n === F.secondaryCoverage) {
    // A secondary coverage listed first must not win: the lowest `order` does.
    coverages = [
      coverage(n + 1000, id, lastUpdated, {
        order: 2,
        subscriberId: sandboxMemberId(n + 1000),
        identifier: [
          {
            type: { coding: [{ system: V2_0203, code: "MB" }] },
            system: `${SANDBOX_BASE_URL}/member`,
            value: sandboxMemberId(n + 1000),
          },
        ],
        payor: [{ reference: "Organization/syn-org-2", display: "Synthetic Health Plan B" }],
      }),
      coverage(n, id, lastUpdated),
    ];
  }
  return { id, lastUpdated, resource, coverages };
}

/**
 * The synthetic population a `SandboxTransport` serves. Mutable on purpose, for tests and the
 * demonstration of a later sync: `patch` changes a patient the way an EHR edit would (a new
 * `versionId` and `lastUpdated`).
 */
export class SandboxDataset {
  readonly patients: SandboxPatient[];

  constructor(count: number = SANDBOX_PATIENT_COUNT, now: Date = new Date()) {
    const random = prng(20260928);
    this.patients = Array.from({ length: count }, (_, index) => buildPatient(index + 1, random, now));
  }

  patient(id: string): SandboxPatient | undefined {
    return this.patients.find((patient) => patient.id === id);
  }

  /** Applies an edit as an EHR would: bumps `meta.versionId` and sets `meta.lastUpdated` to `at`. */
  patch(id: string, edit: (resource: FhirJson, coverages: FhirJson[]) => void, at: Date): void {
    const patient = this.patient(id);
    if (!patient) throw new Error("unknown sandbox patient");
    edit(patient.resource, patient.coverages);
    const meta = patient.resource.meta as FhirJson;
    meta.versionId = String(Number(meta.versionId) + 1);
    meta.lastUpdated = at.toISOString();
    patient.lastUpdated = at;
  }
}
