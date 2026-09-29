// Pure X12 837P (005010X222A1) generator for ONE professional claim (docs/specs/claims.md C3a).
//
// No I/O and no clock: the time and the control number are inputs, so the output is reproducible and the
// golden-file test is byte for byte. Nothing here reads a database or an environment variable.
//
// Rules this module enforces (CLAUDE.md #8, R-3.10.1, R-3.10.2): diagnosis, procedure, and modifier codes,
// units, dates, and amounts are copied exactly as given. The only change to any code is removing the
// ICD-10-CM decimal point, which X12 does not carry (a change of representation, reversible with
// `restoreIcd10Decimal`). A code that is not shaped correctly is refused, never repaired. Free text (names,
// addresses) is upper-cased and stripped of accents, nothing else.
//
// Refusals carry a fixed code and, for a line, its number, never a value (R-7.4.6, CLAUDE.md #4): they are
// safe to log, audit, and show. Which loops, segments, and elements are written is the mapping table in the
// spec; usage or code values not certain are marked there as VERIFY.

import { PRACTICE_TIME_ZONE } from "@rules/calendar";
import type { Regime } from "@rules/types";

export class Edi837Error extends Error {
  constructor(
    readonly issues: Issue837[],
    message = "837P validation failed",
  ) {
    super(message);
    this.name = "Edi837Error";
  }
}

export type Issue837Code =
  | "status_not_generatable"
  | "not_synthetic_environment"
  | "no_member_id"
  | "coverage_payer_mismatch"
  | "payer_not_verified"
  | "claim_filing_indicator_unmapped"
  | "billing_npi"
  | "billing_name"
  | "billing_taxonomy"
  | "billing_tin"
  | "billing_address"
  | "billing_address_po_box"
  | "subscriber_name"
  | "subscriber_birth_date"
  | "subscriber_address"
  | "missing_place_of_service"
  | "diagnosis_invalid"
  | "diagnosis_pointers_required"
  | "diagnosis_pointer_invalid"
  | "lines_missing"
  | "lines_too_many"
  | "line_invalid"
  | "billed_mismatch"
  | "claim_number_invalid"
  | "service_date_invalid"
  | "invalid_character"
  | "control_number_exhausted";

/** Never holds a value: a code, the line it concerns, and (for invalid_character) the field's name. */
export interface Issue837 {
  code: Issue837Code;
  line?: number;
  field?: string;
}

export interface Envelope837 {
  /** ISA06 and GS02, at most 15 characters. */
  senderId: string;
  /** ISA08 and GS03, at most 15 characters. */
  receiverId: string;
  submitterName: string;
  submitterId: string;
  submitterContactName: string;
  submitterPhone: string;
  receiverName: string;
  receiverLoopId: string;
}

/**
 * Fixed synthetic identifiers for C3a. They identify nobody, so a file carrying them can only be a test
 * file (ISA15 = T). Real submitter and receiver identifiers come from clearinghouse enrollment in C3b.
 */
export const SYNTHETIC_ENVELOPE: Envelope837 = {
  senderId: "SYNTHDENIALDESK",
  receiverId: "SYNTHCLEARINGHS",
  submitterName: "SYNTHETIC BILLING SERVICE",
  submitterId: "SYNTHSUBMITTER1",
  submitterContactName: "SYNTHETIC CONTACT",
  submitterPhone: "5555550100",
  receiverName: "SYNTHETIC CLEARINGHOUSE",
  receiverLoopId: "SYNTHRECEIVER1",
};

export interface Line837 {
  lineNumber: number;
  procedureCode: string;
  modifiers: string[];
  units: number;
  chargeCents: number;
  /** 1-based positions in `diagnosisCodes`; null = not chosen yet (refused). */
  diagnosisPointers: number[] | null;
}

export interface Claim837Input {
  envelope: Envelope837;
  /** C3a writes `T` only. */
  usage: "T";
  /** ISA13, GS06, ST02, and BHT03: 1 to 999,999,999. */
  controlNumber: number;
  createdAt: Date;
  billingProvider: {
    npi: string | null;
    lastName: string | null;
    firstName: string | null;
    taxonomy: string | null;
    tinType: "EI" | "SY" | null;
    tin: string | null;
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  };
  subscriber: {
    memberId: string | null;
    lastName: string | null;
    firstName: string | null;
    /** YYYY-MM-DD */
    birthDate: string | null;
    sex: "F" | "M" | "U";
    addressLine1: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  };
  payer: { name: string; ediPayerId: string | null; regime: Regime | null };
  claim: {
    claimNumber: string;
    /** YYYY-MM-DD */
    serviceDate: string;
    diagnosisCodes: string[];
    totalCents: number;
    placeOfService: string | null;
    lines: Line837[];
  };
}

export interface Built837 {
  text: string;
  /** Segments in the whole file, ISA through IEA. */
  segmentCount: number;
}

export const MAX_SERVICE_LINES = 50;
export const MAX_CONTROL_NUMBER = 999_999_999;
const MAX_DIAGNOSES = 12;
const MAX_MODIFIERS = 4;
const MAX_POINTERS = 4;

// The same shapes as the C1 correction form (`CPT_HCPCS`, `MODIFIER`, `ICD10CM` in
// src/domain/claims/correction.ts); 837p.test.ts asserts they are identical.
export const CPT_HCPCS_SHAPE = /^[A-Z0-9]{5}$/;
export const MODIFIER_SHAPE = /^[A-Z0-9]{2}$/;
export const ICD10CM_SHAPE = /^[A-Z][0-9][0-9A-Z](\.?[0-9A-Z]{1,4})?$/;

/**
 * Claim filing indicator (2000B SBR09) by the payer's regime. Values believed correct but still VERIFY against the guide (spec C3a);
 * the other regimes are refused until the owner confirms them (spec C3a, open question 6).
 */
export const CLAIM_FILING_INDICATOR: Partial<Record<Regime, string>> = {
  fl_insurer: "CI",
  fl_hmo: "HM",
  medicare: "MB",
  medicaid_ffs: "MC",
  workers_comp: "WC",
};

// ---------------------------------------------------------------------------------------------
// Representation helpers (no code is ever changed, only how it is written)
// ---------------------------------------------------------------------------------------------

/** ICD-10-CM as X12 writes it: without the decimal point. The only change made to a code. */
export function icd10ToX12(code: string): string {
  return code.replace(".", "");
}

/** The reverse of `icd10ToX12`: puts the point back after the third character. */
export function restoreIcd10Decimal(x12Code: string): string {
  return x12Code.length > 3 ? `${x12Code.slice(0, 3)}.${x12Code.slice(3)}` : x12Code;
}

/** NPI check digit: Luhn over "80840" plus the first nine digits (CMS NPI standard). */
export function isValidNpi(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;
  const digits = `80840${npi.slice(0, 9)}`.split("").map(Number);
  let sum = 0;
  for (let i = digits.length - 1, double = true; i >= 0; i--, double = !double) {
    let d = digits[i]!;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(npi[9]);
}

/** Integer cents to an exact decimal string, without floating point. */
export function centsToDecimal(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function dateToCcyymmdd(iso: string | null): string | null {
  const match = iso === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${match[1]}${match[2]}${match[3]}`;
}

const TEXT_OK = /^[A-Z0-9 &'(),.\-/#]+$/;

/**
 * Free text as X12 carries it: accents removed, upper-cased, blanks collapsed. Null when a character
 * remains that X12 cannot carry (a separator, a control character, a non-ASCII letter).
 */
function cleanText(value: string | null, max: number): string | null {
  if (value === null) return null;
  const text = value.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/\s+/g, " ").trim();
  return text.length > 0 && text.length <= max && TEXT_OK.test(text) ? text : null;
}

const ID_OK = /^[A-Za-z0-9-]{1,80}$/;
const TAXONOMY = /^[0-9A-Z]{9}X$/;
const PO_BOX = /^(P\.?\s?O\.?\s?BOX|POST OFFICE BOX|LOCKBOX)\b/;

function zip(value: string | null, nineOnly: boolean): string | null {
  const digits = (value ?? "").replace("-", "");
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 9) return digits;
  return !nineOnly && digits.length === 5 ? digits : null;
}

function state(value: string | null): string | null {
  const v = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : null;
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

/** Every problem found, in a stable order, none carrying a value. */
export function validate837P(input: Claim837Input): Issue837[] {
  const issues: Issue837[] = [];
  const add = (code: Issue837Code, extra: Omit<Issue837, "code"> = {}) => issues.push({ code, ...extra });
  /** A present value that X12 can't carry (or is too long): named by field, never quoted. */
  const text = (field: string, value: string | null, max: number) => {
    if (value !== null && value.trim() !== "" && cleanText(value, max) === null)
      add("invalid_character", { field });
  };

  const { billingProvider: bp, subscriber: sub, payer, claim } = input;
  if (input.envelope.senderId.length > 15 || input.envelope.receiverId.length > 15)
    add("invalid_character", { field: "envelope_id" });

  if (
    !Number.isInteger(input.controlNumber) ||
    input.controlNumber < 1 ||
    input.controlNumber > MAX_CONTROL_NUMBER
  )
    add("control_number_exhausted");

  // Billing provider (2010AA)
  if (bp.npi === null || !isValidNpi(bp.npi)) add("billing_npi");
  if (
    bp.lastName === null ||
    bp.firstName === null ||
    bp.lastName.trim() === "" ||
    bp.firstName.trim() === ""
  )
    add("billing_name");
  else {
    text("billing_last_name", bp.lastName, 60);
    text("billing_first_name", bp.firstName, 35);
  }
  if (bp.taxonomy === null || !TAXONOMY.test(bp.taxonomy)) add("billing_taxonomy");
  if (bp.tinType === null || bp.tin === null || !/^\d{9}$/.test(bp.tin)) add("billing_tin");
  text("billing_address", bp.addressLine1, 55);
  text("billing_city", bp.city, 30);
  const billingLine = cleanText(bp.addressLine1, 55);
  if (
    billingLine === null ||
    cleanText(bp.city, 30) === null ||
    state(bp.state) === null ||
    zip(bp.postalCode, true) === null
  )
    add("billing_address");
  else if (PO_BOX.test(billingLine)) add("billing_address_po_box");

  // Subscriber (2010BA): the patient
  if (
    sub.lastName === null ||
    sub.firstName === null ||
    sub.lastName.trim() === "" ||
    sub.firstName.trim() === ""
  )
    add("subscriber_name");
  else {
    text("subscriber_last_name", sub.lastName, 60);
    text("subscriber_first_name", sub.firstName, 35);
  }
  if (dateToCcyymmdd(sub.birthDate) === null) add("subscriber_birth_date");
  if (sub.memberId === null || sub.memberId === "") add("no_member_id");
  else if (!ID_OK.test(sub.memberId)) add("invalid_character", { field: "subscriber_member_id" });
  text("subscriber_address", sub.addressLine1, 55);
  text("subscriber_city", sub.city, 30);
  if (
    cleanText(sub.addressLine1, 55) === null ||
    cleanText(sub.city, 30) === null ||
    state(sub.state) === null ||
    zip(sub.postalCode, false) === null
  )
    add("subscriber_address");

  // Payer (2010BB) and claim filing indicator (2000B SBR09)
  if (payer.ediPayerId === null || payer.regime === null || !/^[A-Za-z0-9]{1,80}$/.test(payer.ediPayerId))
    add("payer_not_verified");
  else if (CLAIM_FILING_INDICATOR[payer.regime] === undefined) add("claim_filing_indicator_unmapped");
  if (cleanText(payer.name, 60) === null) add("invalid_character", { field: "payer_name" });

  // Claim (2300)
  if (!/^[A-Za-z0-9._-]{1,38}$/.test(claim.claimNumber)) add("claim_number_invalid");
  if (claim.placeOfService === null || !/^\d{2}$/.test(claim.placeOfService)) add("missing_place_of_service");
  if (dateToCcyymmdd(claim.serviceDate) === null) add("service_date_invalid");
  const dx = claim.diagnosisCodes;
  if (dx.length < 1 || dx.length > MAX_DIAGNOSES || dx.some((code) => !ICD10CM_SHAPE.test(code)))
    add("diagnosis_invalid");

  // Service lines (2400)
  if (claim.lines.length < 1) add("lines_missing");
  if (claim.lines.length > MAX_SERVICE_LINES) add("lines_too_many");
  let sum = 0;
  let sumValid = true;
  for (const line of claim.lines) {
    const modifiersOk =
      line.modifiers.length <= MAX_MODIFIERS && line.modifiers.every((m) => MODIFIER_SHAPE.test(m));
    const ok =
      Number.isInteger(line.lineNumber) &&
      line.lineNumber >= 1 &&
      CPT_HCPCS_SHAPE.test(line.procedureCode) &&
      modifiersOk &&
      Number.isInteger(line.units) &&
      line.units >= 1 &&
      line.units <= 999 &&
      Number.isInteger(line.chargeCents) &&
      line.chargeCents >= 1 &&
      line.chargeCents <= 9_999_999;
    if (!ok) {
      add("line_invalid", { line: line.lineNumber });
      sumValid = false;
    } else sum += line.chargeCents;
    const pointers = line.diagnosisPointers;
    if (pointers === null) add("diagnosis_pointers_required", { line: line.lineNumber });
    else if (
      pointers.length < 1 ||
      pointers.length > MAX_POINTERS ||
      new Set(pointers).size !== pointers.length ||
      pointers.some((p) => !Number.isInteger(p) || p < 1 || p > dx.length)
    )
      add("diagnosis_pointer_invalid", { line: line.lineNumber });
  }
  const numbers = claim.lines.map((l) => l.lineNumber);
  if (new Set(numbers).size !== numbers.length) add("line_invalid");
  if (sumValid && claim.lines.length > 0 && sum !== claim.totalCents) add("billed_mismatch");
  return issues;
}

// ---------------------------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------------------------

const EL = "*";
const SEG = "~";

/** One segment: trailing empty elements are dropped, as the guide's "do not send trailing separators". */
function seg(id: string, ...elements: string[]): string {
  const list = [...elements];
  while (list.length > 0 && list[list.length - 1] === "") list.pop();
  return [id, ...list].join(EL);
}

/** Hides all but the last `keep` characters; a value no longer than `keep` is hidden entirely. */
function maskTail(value: string, keep: number): string {
  if (value.length <= keep) return "•".repeat(value.length);
  return `${"•".repeat(value.length - keep)}${value.slice(-keep)}`;
}

/**
 * Builds the file. Throws `Edi837Error` (issues only, no values) when the input is not valid.
 * `mask` (preview only, never the file) hides the member ID and TIN except their last four characters.
 */
export function build837P(input: Claim837Input, options: { mask?: boolean } = {}): Built837 {
  const issues = validate837P(input);
  if (issues.length > 0) throw new Edi837Error(issues);

  const { envelope: env, billingProvider: bp, subscriber: sub, payer, claim } = input;
  const t = (value: string, max: number): string => cleanText(value, max)!;
  const control9 = String(input.controlNumber).padStart(9, "0");
  const control4 = String(input.controlNumber).padStart(4, "0");
  // Dates and times in the practice's time zone (Eastern), not UTC.
  const clock = new Intl.DateTimeFormat("en-CA", {
    timeZone: PRACTICE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(input.createdAt);
  const part = (type: string) => clock.find((p) => p.type === type)!.value;
  const yyyymmdd = `${part("year")}${part("month")}${part("day")}`;
  const hhmm = `${part("hour")}${part("minute")}`;
  const tin = options.mask ? maskTail(bp.tin!, 4) : bp.tin!;
  const memberId = options.mask ? maskTail(sub.memberId!, 4) : sub.memberId!;
  const dx = claim.diagnosisCodes.map(icd10ToX12);

  const body: string[] = [
    seg("ST", "837", control4, "005010X222A1"),
    seg("BHT", "0019", "00", control9, yyyymmdd, hhmm, "CH"),
    // 1000A submitter, 1000B receiver
    seg("NM1", "41", "2", t(env.submitterName, 60), "", "", "", "", "46", env.submitterId),
    seg("PER", "IC", t(env.submitterContactName, 60), "TE", env.submitterPhone),
    seg("NM1", "40", "2", t(env.receiverName, 60), "", "", "", "", "46", env.receiverLoopId),
    // 2000A billing provider
    seg("HL", "1", "", "20", "1"),
    seg("PRV", "BI", "PXC", bp.taxonomy!),
    seg("NM1", "85", "1", t(bp.lastName!, 60), t(bp.firstName!, 35), "", "", "", "XX", bp.npi!),
    seg("N3", t(bp.addressLine1!, 55)),
    seg("N4", t(bp.city!, 30), state(bp.state)!, zip(bp.postalCode, true)!),
    seg("REF", bp.tinType!, tin),
    // 2000B subscriber (the patient, primary coverage)
    seg("HL", "2", "1", "22", "0"),
    seg("SBR", "P", "18", "", "", "", "", "", "", CLAIM_FILING_INDICATOR[payer.regime!]!),
    seg("NM1", "IL", "1", t(sub.lastName!, 60), t(sub.firstName!, 35), "", "", "", "MI", memberId),
    seg("N3", t(sub.addressLine1!, 55)),
    seg("N4", t(sub.city!, 30), state(sub.state)!, zip(sub.postalCode, false)!),
    seg("DMG", "D8", dateToCcyymmdd(sub.birthDate)!, sub.sex),
    // 2010BB payer
    seg("NM1", "PR", "2", t(payer.name, 60), "", "", "", "", "PI", payer.ediPayerId!),
    // 2300 claim: frequency code 1 (original) only in C3a
    seg(
      "CLM",
      claim.claimNumber,
      centsToDecimal(claim.totalCents),
      "",
      "",
      `${claim.placeOfService}:B:1`,
      "Y",
      "A",
      "Y",
      "Y",
    ),
    seg("HI", ...dx.map((code, i) => `${i === 0 ? "ABK" : "ABF"}:${code}`)),
  ];

  // LX01 counts 1..n in order; it does not copy the claim's own line numbers.
  const ordered = [...claim.lines].sort((a, b) => a.lineNumber - b.lineNumber);
  for (const [index, line] of ordered.entries()) {
    const service = ["HC", line.procedureCode, ...line.modifiers].join(":");
    body.push(
      seg("LX", String(index + 1)),
      seg(
        "SV1",
        service,
        centsToDecimal(line.chargeCents),
        "UN",
        String(line.units),
        "",
        "",
        line.diagnosisPointers!.join(":"),
      ),
      seg("DTP", "472", "D8", dateToCcyymmdd(claim.serviceDate)!),
    );
  }
  // SE01 counts ST through SE inclusive.
  body.push(seg("SE", String(body.length + 1), control4));

  const isa = seg(
    "ISA",
    "00",
    " ".repeat(10),
    "00",
    " ".repeat(10),
    "ZZ",
    env.senderId.padEnd(15),
    "ZZ",
    env.receiverId.padEnd(15),
    `${yyyymmdd.slice(2)}`,
    hhmm,
    "^",
    "00501",
    control9,
    "0",
    input.usage,
    ":",
  );
  const segments = [
    isa,
    seg(
      "GS",
      "HC",
      env.senderId.trim(),
      env.receiverId.trim(),
      yyyymmdd,
      hhmm,
      control9,
      "X",
      "005010X222A1",
    ),
    ...body,
    seg("GE", "1", control9),
    seg("IEA", "1", control9),
  ];
  return { text: segments.join(SEG) + SEG, segmentCount: segments.length };
}
