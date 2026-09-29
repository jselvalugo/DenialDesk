import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CPT_HCPCS, ICD10CM, MODIFIER } from "@/domain/claims/correction";
import {
  build837P,
  centsToDecimal,
  CLAIM_FILING_INDICATOR,
  CPT_HCPCS_SHAPE,
  Edi837Error,
  ICD10CM_SHAPE,
  icd10ToX12,
  isValidNpi,
  MAX_SERVICE_LINES,
  MODIFIER_SHAPE,
  restoreIcd10Decimal,
  validate837P,
  type Claim837Input,
  type Issue837,
  type Line837,
} from "./837p";
import { syntheticClaim } from "./837p.fixture";
import { tokenize } from "./segments";

const GOLDEN = readFileSync("test/fixtures/synthetic/x12/837p-golden.x12", "utf8");

function codes(issues: Issue837[]): string[] {
  return issues.map((i) => i.code);
}

/** A fixture with one field changed, by path of updater. */
function withClaim(change: (input: Claim837Input) => void): Claim837Input {
  const input = structuredClone(syntheticClaim());
  change(input);
  return input;
}

function lines(count: number, extra: Partial<Line837> = {}): Line837[] {
  return Array.from({ length: count }, (_, i) => ({
    lineNumber: i + 1,
    procedureCode: "99213",
    modifiers: [],
    units: 1,
    chargeCents: 1_000,
    diagnosisPointers: [1],
    ...extra,
  }));
}

describe("837P golden file (synthetic claim)", () => {
  it("matches the golden file byte for byte", () => {
    const { text } = build837P(syntheticClaim());
    // One segment per line in the file, for reading; the generator itself writes no line breaks.
    expect(text.split("~").join("~\n")).toBe(GOLDEN);
    expect(text).not.toContain("\n");
  });

  it("is fully synthetic and a test file", () => {
    const { text } = build837P(syntheticClaim());
    expect(text).toContain("*T*:~");
    expect(text).toContain("SYN123456789");
    expect(GOLDEN).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/);
  });
});

describe("837P structure round trip", () => {
  function check(input: Claim837Input) {
    const { text, segmentCount } = build837P(input);
    const { segments, elementSeparator, segmentTerminator } = tokenize(text);
    expect(elementSeparator).toBe("*");
    expect(segmentTerminator).toBe("~");
    expect(segments).toHaveLength(segmentCount);
    // ISA is fixed width: 106 characters, the terminator at index 105.
    expect(text.indexOf("~")).toBe(105);
    const ids = segments.map((s) => s.id);
    const st = ids.indexOf("ST");
    const se = ids.indexOf("SE");
    expect(ids[0]).toBe("ISA");
    expect(ids[1]).toBe("GS");
    expect(st).toBe(2);
    // SE01 counts ST through SE inclusive.
    expect(Number(segments[se]!.elements[0])).toBe(se - st + 1);
    expect(segments[se]!.elements[1]).toBe(segments[st]!.elements[1]);
    const gs = segments[1]!;
    const ge = segments[se + 1]!;
    const iea = segments[se + 2]!;
    expect(ge.id).toBe("GE");
    expect(ge.elements).toEqual(["1", gs.elements[5]]);
    expect(iea.id).toBe("IEA");
    expect(iea.elements).toEqual(["1", segments[0]!.elements[12]]);
    expect(iea.elements[1]).toBe(gs.elements[5]);
    // HL hierarchy: 1 (billing provider, child) then 2 (subscriber, no child), one 2300.
    const hl = segments.filter((s) => s.id === "HL").map((s) => s.elements);
    expect(hl).toEqual([
      ["1", "", "20", "1"],
      ["2", "1", "22", "0"],
    ]);
    expect(ids.filter((id) => id === "CLM")).toHaveLength(1);
    expect(ids.filter((id) => id === "LX")).toHaveLength(input.claim.lines.length);
    expect(ids.filter((id) => id === "SV1")).toHaveLength(input.claim.lines.length);
    // CLM02 equals the sum of the SV102 amounts.
    const clm = segments.find((s) => s.id === "CLM")!;
    const svTotal = segments
      .filter((s) => s.id === "SV1")
      .reduce((sum, s) => sum + Math.round(Number(s.elements[1]) * 100), 0);
    expect(Math.round(Number(clm.elements[1]) * 100)).toBe(svTotal);
    return segments;
  }

  it.each([1, 2, 7, MAX_SERVICE_LINES])("holds for %i service lines", (count) => {
    const input = syntheticClaim();
    input.claim.lines = lines(count);
    input.claim.totalCents = count * 1_000;
    check(input);
  });

  it.each([1, 4, 12])("holds for %i diagnoses", (count) => {
    const input = syntheticClaim();
    const all = [
      "E11.9",
      "I10",
      "J45.909",
      "M54.5",
      "R51.9",
      "K21.9",
      "G43.909",
      "N39.0",
      "F41.1",
      "L30.9",
      "H10.9",
      "Z00.00",
    ];
    input.claim.diagnosisCodes = all.slice(0, count);
    // The pointers are a person's choice, so the fixture points every line at the first diagnosis.
    for (const line of input.claim.lines) line.diagnosisPointers = [1];
    const segments = check(input);
    const hi = segments.find((s) => s.id === "HI")!;
    expect(hi.elements).toHaveLength(count);
    expect(hi.elements[0]!.startsWith("ABK:")).toBe(true);
    for (const element of hi.elements.slice(1)) expect(element.startsWith("ABF:")).toBe(true);
  });

  it("holds with and without modifiers, and with four modifiers", () => {
    const input = syntheticClaim();
    input.claim.lines[0]!.modifiers = ["25", "59", "XE", "GT"];
    const segments = check(input);
    expect(segments.find((s) => s.id === "SV1")!.elements[0]).toBe("HC:99213:25:59:XE:GT");
  });

  it("writes frequency code 1, usage T, and the payer's claim filing indicator", () => {
    const { text } = build837P(syntheticClaim());
    expect(text).toContain("*11:B:1*");
    expect(text).toContain("SBR*P*18*******CI~");
  });
});

describe("837P: codes are copied exactly (R-3.10.1)", () => {
  const fixtureDiagnoses = ["E11.9", "I10", "S72.001A", "Z00.00", "A00", "M79.18", "T14.90XA"];

  it("writes every diagnosis without the decimal point and nothing else changed, in order", () => {
    const input = syntheticClaim();
    input.claim.diagnosisCodes = fixtureDiagnoses;
    input.claim.lines = lines(1, { diagnosisPointers: [1, 2, 3, 4] });
    input.claim.totalCents = 1_000;
    const { text } = build837P(input);
    const hi = tokenize(text).segments.find((s) => s.id === "HI")!.elements;
    expect(hi.map((e) => e.split(":")[1])).toEqual([
      "E119",
      "I10",
      "S72001A",
      "Z0000",
      "A00",
      "M7918",
      "T1490XA",
    ]);
    // No diagnosis added, dropped, or reordered.
    expect(hi).toHaveLength(fixtureDiagnoses.length);
  });

  it("round-trips every fixture code through the X12 representation", () => {
    for (const code of fixtureDiagnoses) {
      const x12 = icd10ToX12(code);
      expect(x12).not.toContain(".");
      expect(restoreIcd10Decimal(x12)).toBe(code);
      // Removing the only change gives back the same characters in the same order.
      expect(x12).toBe(code.replace(".", ""));
    }
    expect(restoreIcd10Decimal("A00")).toBe("A00");
  });

  it("never alters procedure codes, modifiers, units, or amounts", () => {
    const input = syntheticClaim();
    input.claim.lines = [
      {
        lineNumber: 1,
        procedureCode: "J1100",
        modifiers: ["RT", "LT"],
        units: 12,
        chargeCents: 99_999_99 - 1,
        diagnosisPointers: [2],
      },
      {
        lineNumber: 2,
        procedureCode: "0001A",
        modifiers: ["59"],
        units: 999,
        chargeCents: 1,
        diagnosisPointers: [1, 2],
      },
    ];
    input.claim.totalCents = 9_999_998 + 1;
    const segments = tokenize(build837P(input).text).segments.filter((s) => s.id === "SV1");
    expect(segments.map((s) => s.elements)).toEqual([
      ["HC:J1100:RT:LT", "99999.98", "UN", "12", "", "", "2"],
      ["HC:0001A:59", "0.01", "UN", "999", "", "", "1:2"],
    ]);
  });

  it("refuses lower-case, padded, or malformed codes instead of repairing them", () => {
    for (const bad of ["e11.9", " E11.9", "E11.9 ", "E", "11.9", "E11.99999", "E11,9"]) {
      const input = withClaim((i) => (i.claim.diagnosisCodes = [bad]));
      input.claim.lines = lines(1);
      input.claim.totalCents = 1_000;
      expect(codes(validate837P(input)), bad).toContain("diagnosis_invalid");
    }
    for (const bad of ["9921", "992133", "9921a", " 99213"]) {
      const input = withClaim((i) => (i.claim.lines[0]!.procedureCode = bad));
      expect(
        validate837P(input).map((i) => i.code),
        bad,
      ).toContain("line_invalid");
    }
    const input = withClaim((i) => (i.claim.lines[0]!.modifiers = ["25", "5"]));
    expect(codes(validate837P(input))).toContain("line_invalid");
  });

  it("uses the same code shapes as the C1 correction form", () => {
    expect(CPT_HCPCS_SHAPE.source).toBe(CPT_HCPCS.source);
    expect(MODIFIER_SHAPE.source).toBe(MODIFIER.source);
    expect(ICD10CM_SHAPE.source).toBe(ICD10CM.source);
  });
});

describe("837P refusals", () => {
  it("accepts the fixture", () => {
    expect(validate837P(syntheticClaim())).toEqual([]);
  });

  const cases: Array<[string, (i: Claim837Input) => void, Issue837]> = [
    ["billing NPI missing", (i) => (i.billingProvider.npi = null), { code: "billing_npi" }],
    ["billing NPI bad check digit", (i) => (i.billingProvider.npi = "1234567890"), { code: "billing_npi" }],
    ["billing NPI short", (i) => (i.billingProvider.npi = "123456789"), { code: "billing_npi" }],
    ["billing name", (i) => (i.billingProvider.firstName = ""), { code: "billing_name" }],
    ["billing taxonomy", (i) => (i.billingProvider.taxonomy = "207R00000Y"), { code: "billing_taxonomy" }],
    ["billing taxonomy missing", (i) => (i.billingProvider.taxonomy = null), { code: "billing_taxonomy" }],
    ["billing TIN missing", (i) => (i.billingProvider.tin = null), { code: "billing_tin" }],
    ["billing TIN short", (i) => (i.billingProvider.tin = "12345678"), { code: "billing_tin" }],
    ["billing TIN type unset", (i) => (i.billingProvider.tinType = null), { code: "billing_tin" }],
    ["billing address line", (i) => (i.billingProvider.addressLine1 = null), { code: "billing_address" }],
    ["billing city", (i) => (i.billingProvider.city = " "), { code: "billing_address" }],
    ["billing state", (i) => (i.billingProvider.state = "FLA"), { code: "billing_address" }],
    [
      "billing ZIP is five digits",
      (i) => (i.billingProvider.postalCode = "33602"),
      { code: "billing_address" },
    ],
    [
      "billing ZIP+4 too short",
      (i) => (i.billingProvider.postalCode = "33602-123"),
      { code: "billing_address" },
    ],
    [
      "billing P.O. box",
      (i) => (i.billingProvider.addressLine1 = "PO Box 12"),
      { code: "billing_address_po_box" },
    ],
    [
      "billing P.O. box dotted",
      (i) => (i.billingProvider.addressLine1 = "P.O. Box 12"),
      { code: "billing_address_po_box" },
    ],
    ["subscriber name", (i) => (i.subscriber.lastName = null), { code: "subscriber_name" }],
    [
      "subscriber birth date",
      (i) => (i.subscriber.birthDate = "1980-02-30"),
      { code: "subscriber_birth_date" },
    ],
    [
      "subscriber birth date missing",
      (i) => (i.subscriber.birthDate = null),
      { code: "subscriber_birth_date" },
    ],
    ["member ID null", (i) => (i.subscriber.memberId = null), { code: "no_member_id" }],
    ["member ID empty", (i) => (i.subscriber.memberId = ""), { code: "no_member_id" }],
    ["subscriber address", (i) => (i.subscriber.addressLine1 = null), { code: "subscriber_address" }],
    ["subscriber ZIP", (i) => (i.subscriber.postalCode = "3360"), { code: "subscriber_address" }],
    ["payer without EDI ID", (i) => (i.payer.ediPayerId = null), { code: "payer_not_verified" }],
    ["payer without regime", (i) => (i.payer.regime = null), { code: "payer_not_verified" }],
    [
      "regime without a confirmed indicator",
      (i) => (i.payer.regime = "medicare_advantage"),
      { code: "claim_filing_indicator_unmapped" },
    ],
    ["claim number", (i) => (i.claim.claimNumber = "A B"), { code: "claim_number_invalid" }],
    [
      "place of service missing",
      (i) => (i.claim.placeOfService = null),
      { code: "missing_place_of_service" },
    ],
    ["place of service shape", (i) => (i.claim.placeOfService = "1"), { code: "missing_place_of_service" }],
    ["service date", (i) => (i.claim.serviceDate = "2026-13-01"), { code: "service_date_invalid" }],
    ["no diagnosis", (i) => (i.claim.diagnosisCodes = []), { code: "diagnosis_invalid" }],
    [
      "pointers not chosen",
      (i) => (i.claim.lines[0]!.diagnosisPointers = null),
      { code: "diagnosis_pointers_required", line: 1 },
    ],
    [
      "pointer past the diagnoses",
      (i) => (i.claim.lines[1]!.diagnosisPointers = [3]),
      { code: "diagnosis_pointer_invalid", line: 2 },
    ],
    [
      "pointer zero",
      (i) => (i.claim.lines[1]!.diagnosisPointers = [0]),
      { code: "diagnosis_pointer_invalid", line: 2 },
    ],
    [
      "pointer repeated",
      (i) => (i.claim.lines[0]!.diagnosisPointers = [1, 1]),
      { code: "diagnosis_pointer_invalid", line: 1 },
    ],
    [
      "no pointer",
      (i) => (i.claim.lines[0]!.diagnosisPointers = []),
      { code: "diagnosis_pointer_invalid", line: 1 },
    ],
    ["units zero", (i) => (i.claim.lines[0]!.units = 0), { code: "line_invalid", line: 1 }],
    ["units 1000", (i) => (i.claim.lines[0]!.units = 1000), { code: "line_invalid", line: 1 }],
    ["charge zero", (i) => (i.claim.lines[0]!.chargeCents = 0), { code: "line_invalid", line: 1 }],
    [
      "charge fractional cents",
      (i) => (i.claim.lines[0]!.chargeCents = 12_500.5),
      { code: "line_invalid", line: 1 },
    ],
    ["billed does not add up", (i) => (i.claim.totalCents = 15_501), { code: "billed_mismatch" }],
    ["control number zero", (i) => (i.controlNumber = 0), { code: "control_number_exhausted" }],
    [
      "control number past nine digits",
      (i) => (i.controlNumber = 1_000_000_000),
      { code: "control_number_exhausted" },
    ],
  ];
  it.each(cases)("refuses: %s", (_name, change, expected) => {
    expect(validate837P(withClaim(change))).toContainEqual(expected);
  });

  it("refuses no lines", () => {
    const input = withClaim((i) => {
      i.claim.lines = [];
      i.claim.totalCents = 0;
    });
    expect(codes(validate837P(input))).toContain("lines_missing");
  });

  it("boundaries: 12 and 13 diagnoses, 50 and 51 lines, 4 and 5 modifiers, ZIP forms", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `A0${i % 10}`);
    expect(codes(validate837P(withClaim((i) => (i.claim.diagnosisCodes = twelve))))).not.toContain(
      "diagnosis_invalid",
    );
    expect(codes(validate837P(withClaim((i) => (i.claim.diagnosisCodes = [...twelve, "B00"]))))).toContain(
      "diagnosis_invalid",
    );
    const at = (n: number) =>
      withClaim((i) => {
        i.claim.lines = lines(n);
        i.claim.totalCents = n * 1_000;
      });
    expect(validate837P(at(50))).toEqual([]);
    expect(codes(validate837P(at(51)))).toContain("lines_too_many");
    const mods = (m: string[]) =>
      withClaim((i) => {
        i.claim.lines[0]!.modifiers = m;
      });
    expect(validate837P(mods(["25", "59", "XE", "GT"]))).toEqual([]);
    expect(codes(validate837P(mods(["25", "59", "XE", "GT", "RT"])))).toContain("line_invalid");
    const zip = (postalCode: string) => withClaim((i) => (i.billingProvider.postalCode = postalCode));
    expect(validate837P(zip("33602-0001"))).toEqual([]);
    expect(validate837P(zip("336020001"))).toEqual([]);
    expect(codes(validate837P(zip("33602000")))).toContain("billing_address");
    expect(validate837P(withClaim((i) => (i.subscriber.postalCode = "33602-0001")))).toEqual([]);
  });

  it("reports every problem together, not only the first", () => {
    const input = withClaim((i) => {
      i.billingProvider.npi = null;
      i.billingProvider.tin = null;
      i.subscriber.memberId = null;
      i.claim.placeOfService = null;
      i.claim.lines[0]!.diagnosisPointers = null;
    });
    expect(codes(validate837P(input))).toEqual([
      "billing_npi",
      "billing_tin",
      "no_member_id",
      "missing_place_of_service",
      "diagnosis_pointers_required",
    ]);
  });

  it("build throws Edi837Error carrying the issues and no value", () => {
    const input = withClaim((i) => {
      i.subscriber.memberId = null;
      i.subscriber.lastName = "Synthpatient";
    });
    try {
      build837P(input);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(Edi837Error);
      const e = error as Edi837Error;
      expect(e.issues).toEqual([{ code: "no_member_id" }]);
      expect(e.message).toBe("837P validation failed");
    }
  });

  it("no refusal or error holds a name, ID, code, date, or amount", () => {
    const input = withClaim((i) => {
      i.billingProvider.npi = "9999999999";
      i.billingProvider.addressLine1 = "PO Box 77 Synthetic Way";
      i.subscriber.memberId = "SYN-BAD*ID";
      i.subscriber.birthDate = "1980-02-31";
      i.claim.diagnosisCodes = ["e11.9"];
      i.claim.lines[0]!.chargeCents = 0;
      i.claim.totalCents = 1;
    });
    const issues = validate837P(input);
    expect(issues.length).toBeGreaterThan(3);
    const text = JSON.stringify(issues);
    for (const secret of ["SYN", "Synth", "9999999999", "PO Box", "e11", "1980", "Avery", "Jane", "Way"])
      expect(text).not.toContain(secret);
    expect(text).toMatch(/^[\w[\]{}":,]+$/);
  });
});

describe("837P text handling", () => {
  it("upper-cases and removes accents without changing anything else", () => {
    const input = withClaim((i) => {
      i.subscriber.firstName = "José";
      i.subscriber.lastName = "O'Brien-Núñez";
      i.subscriber.city = "Fort Lauderdale";
    });
    const nm1 = tokenize(build837P(input).text).segments.find(
      (s) => s.id === "NM1" && s.elements[0] === "IL",
    )!;
    expect(nm1.elements.slice(2, 4)).toEqual(["O'BRIEN-NUNEZ", "JOSE"]);
  });

  it("refuses characters X12 cannot carry, naming the field only", () => {
    for (const bad of ["A*B", "A~B", "A:B", "A^B", "A\u0000B", "Ørsted"]) {
      const input = withClaim((i) => (i.subscriber.lastName = bad));
      const issues = validate837P(input);
      expect(issues).toContainEqual({ code: "invalid_character", field: "subscriber_last_name" });
      expect(JSON.stringify(issues)).not.toContain("Ørsted");
    }
    const bad = withClaim((i) => (i.subscriber.memberId = "SYN 1"));
    expect(validate837P(bad)).toContainEqual({ code: "invalid_character", field: "subscriber_member_id" });
  });

  it("collapses runs of blanks in free text", () => {
    const input = withClaim((i) => (i.billingProvider.addressLine1 = "  100   Synthetic  Way "));
    expect(build837P(input).text).toContain("N3*100 SYNTHETIC WAY~");
  });

  it("never lets a delimiter into the file from any field", () => {
    const { text } = build837P(syntheticClaim());
    const { segments } = tokenize(text);
    for (const s of segments.slice(2)) for (const e of s.elements) expect(e).not.toMatch(/[~^]/);
  });

  it("writes amounts exactly, without floating point", () => {
    expect(centsToDecimal(1)).toBe("0.01");
    expect(centsToDecimal(10)).toBe("0.10");
    expect(centsToDecimal(100)).toBe("1.00");
    expect(centsToDecimal(9_999_999)).toBe("99999.99");
    expect(centsToDecimal(12_345)).toBe("123.45");
  });

  it("checks the NPI check digit", () => {
    expect(isValidNpi("1234567893")).toBe(true);
    expect(isValidNpi("1234567890")).toBe(false);
    expect(isValidNpi("12345678")).toBe(false);
    expect(isValidNpi("123456789A")).toBe(false);
  });

  it("maps only the confirmed regimes to a claim filing indicator", () => {
    expect(CLAIM_FILING_INDICATOR).toEqual({
      fl_insurer: "CI",
      fl_hmo: "HM",
      medicare: "MB",
      medicaid_ffs: "MC",
      workers_comp: "WC",
    });
    for (const regime of ["medicare_advantage", "erisa_self_funded", "smmc", "pip"] as const)
      expect(CLAIM_FILING_INDICATOR[regime]).toBeUndefined();
  });
});

describe("837P preview masking", () => {
  it("hides the member ID and TIN except their last four, and never in the file", () => {
    const masked = build837P(syntheticClaim(), { mask: true }).text;
    expect(masked).not.toContain("SYN123456789");
    expect(masked).not.toContain("000000001");
    expect(masked).toContain("MI*••••••••6789~");
    expect(masked).toContain("REF*EI*•••••0001~");
    const real = build837P(syntheticClaim()).text;
    expect(real).toContain("MI*SYN123456789~");
    expect(real).toContain("REF*EI*000000001~");
    expect(real).not.toContain("•");
    // Same shape and segment count; only those two elements differ.
    expect(tokenize(masked).segments.map((s) => s.id)).toEqual(tokenize(real).segments.map((s) => s.id));
  });
});
