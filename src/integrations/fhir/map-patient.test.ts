import { describe, expect, it } from "vitest";
import { todayIn } from "@rules/calendar";
import { mapPatient, type MapPatientContext } from "./map-patient";
import { SKIP_CODES } from "./sync-codes";

// docs/specs/patient-integrations.md "Field mapping" (FHIR R4 / US Core 6.1.0 -> `patients`). Every
// value is synthetic. A record failing a required rule is skipped with a code, never partially guessed.

const MRN_SYSTEM = "https://ehr.example.test/mrn";
const NOW = new Date("2026-09-28T12:00:00.000Z");
const TODAY = "2026-09-28";
const ctx: MapPatientContext = { mrnSystem: MRN_SYSTEM, nineDigitsVerified: false, now: NOW, today: TODAY };

function patient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    resourceType: "Patient",
    id: "syn-1",
    meta: { versionId: "3", lastUpdated: "2026-09-01T08:30:00.000Z" },
    identifier: [{ system: MRN_SYSTEM, value: "SYN-0000042" }],
    active: true,
    name: [{ use: "official", family: "Testpatient", given: ["Fhira", "Middle"] }],
    gender: "female",
    birthDate: "1990-06-15",
    address: [{ use: "home", line: ["100 Palm Way"], city: "Tampa", state: "fl", postalCode: "33601" }],
    telecom: [{ system: "phone", value: "555-0100" }],
    ...overrides,
  };
}

function mapped(overrides: Record<string, unknown> = {}) {
  const result = mapPatient(patient(overrides), ctx);
  if (!result.ok) throw new Error(`expected a mapped patient, got ${result.code}`);
  return result;
}
const skipped = (overrides: Record<string, unknown>) => {
  const result = mapPatient(patient(overrides), ctx);
  return result.ok ? "mapped" : result.code;
};

describe("mapPatient — the happy path", () => {
  it("maps the billing minimum and nothing else", () => {
    const { patient: p, notes } = mapped();
    expect(p).toEqual({
      externalId: "syn-1",
      sourceVersionId: "3",
      sourceLastUpdated: new Date("2026-09-01T08:30:00.000Z"),
      mrn: "SYN-0000042",
      firstName: "Fhira",
      lastName: "Testpatient",
      birthDate: "1990-06-15",
      sex: "F",
      addressLine1: "100 Palm Way",
      city: "Tampa",
      state: "FL",
      postalCode: "33601",
      sourceStatus: null,
      sourceRestricted: false,
      sourceSensitivity: [],
    });
    expect(notes).toEqual([]);
    // Telecom, e-mail, race and the rest are never read: nothing of them is on the result.
    expect(JSON.stringify(p)).not.toContain("555");
  });
});

describe("mapPatient — required rules skip with a code", () => {
  it("a resource that is not a Patient, or fails the allow-list schema", () => {
    expect(mapPatient({ resourceType: "Practitioner", id: "x" }, ctx)).toEqual({
      ok: false,
      code: "resource_invalid",
    });
    expect(mapPatient("nope", ctx)).toEqual({ ok: false, code: "resource_invalid" });
    expect(skipped({ active: "yes" })).toBe("resource_invalid");
  });

  it("Patient.id must be present and FHIR id syntax", () => {
    expect(skipped({ id: undefined })).toBe("id_invalid");
    expect(skipped({ id: "has space" })).toBe("id_invalid");
    expect(skipped({ id: "a".repeat(65) })).toBe("id_invalid");
    expect(skipped({ id: "ok.id-1" })).toBe("mapped");
  });

  it("names the Patient.id on a skip that follows a valid one", () => {
    expect(mapPatient(patient({ birthDate: "1985-04" }), ctx)).toEqual({
      ok: false,
      code: "birthdate_incomplete",
      externalId: "syn-1",
    });
  });

  it("MRN: exactly one identifier of the connection's system", () => {
    expect(skipped({ identifier: [] })).toBe("mrn_missing");
    expect(skipped({ identifier: [{ system: "https://other.example.test/mrn", value: "X1" }] })).toBe(
      "mrn_missing",
    );
    expect(skipped({ identifier: [{ system: MRN_SYSTEM, value: "  " }] })).toBe("mrn_missing");
    expect(
      skipped({
        identifier: [
          { system: MRN_SYSTEM, value: "A1" },
          { system: MRN_SYSTEM, value: "A2" },
        ],
      }),
    ).toBe("mrn_ambiguous");
    // The same value twice is one MRN.
    expect(
      skipped({
        identifier: [
          { system: MRN_SYSTEM, value: "A1" },
          { system: MRN_SYSTEM, value: "A1" },
        ],
      }),
    ).toBe("mapped");
  });

  it("MRN: refuses a government identifier type (SS, MB, MC, DL, PPN), whatever the system", () => {
    for (const code of ["SS", "MB", "MC", "DL", "PPN"]) {
      const identifier = [
        {
          system: MRN_SYSTEM,
          value: "A1234",
          type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code }] },
        },
      ];
      expect(skipped({ identifier })).toBe("mrn_government_identifier");
    }
    // MR (medical record number) is what we want.
    expect(
      skipped({
        identifier: [
          {
            system: MRN_SYSTEM,
            value: "A1234",
            type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] },
          },
        ],
      }),
    ).toBe("mapped");
  });

  it("MRN: refuses SSN- and MBI-shaped values, and an invalid one", () => {
    const withValue = (value: string) => ({ identifier: [{ system: MRN_SYSTEM, value }] });
    expect(skipped(withValue("123-45-6789"))).toBe("mrn_looks_like_ssn");
    expect(skipped(withValue("123456789"))).toBe("mrn_looks_like_ssn");
    expect(skipped(withValue("1EG4-TE5-MK73"))).toBe("mrn_looks_like_mbi");
    expect(skipped(withValue("has space"))).toBe("mrn_invalid");
    // The database allows 1 to 40 characters (patients_mrn_present): 41 would fail the INSERT.
    expect(skipped(withValue("x".repeat(41)))).toBe("mrn_invalid");
    expect(skipped(withValue("x".repeat(40)))).toBe("mapped");
  });

  it("MRN: nine digits are allowed once the operator has recorded that the practice's MRNs are nine digits", () => {
    const result = mapPatient(patient({ identifier: [{ system: MRN_SYSTEM, value: "123456789" }] }), {
      ...ctx,
      nineDigitsVerified: true,
    });
    expect(result.ok).toBe(true);
  });

  it("name: official, else usual, else the only one; given[0] and family are required", () => {
    expect(
      mapped({
        name: [
          { use: "nickname", family: "Nick", given: ["N"] },
          { use: "usual", family: "Usual", given: ["Una"] },
        ],
      }).patient,
    ).toMatchObject({ firstName: "Una", lastName: "Usual" });
    expect(mapped({ name: [{ family: "Only", given: ["One"] }] }).patient).toMatchObject({
      firstName: "One",
    });
    expect(
      skipped({
        name: [
          { use: "nickname", family: "A", given: ["A"] },
          { use: "maiden", family: "B", given: ["B"] },
        ],
      }),
    ).toBe("name_incomplete");
    expect(skipped({ name: [{ family: "NoGiven" }] })).toBe("name_incomplete");
    expect(skipped({ name: [{ given: ["NoFamily"] }] })).toBe("name_incomplete");
    expect(skipped({ name: [] })).toBe("name_incomplete");
    expect(skipped({ name: [{ family: "Ba​d", given: ["Name"] }] })).toBe("name_invalid");
    // patients_names_present: 1 to 60 characters each.
    expect(skipped({ name: [{ family: "x".repeat(61), given: ["Name"] }] })).toBe("name_invalid");
    expect(skipped({ name: [{ family: "Family", given: ["x".repeat(61)] }] })).toBe("name_invalid");
    expect(skipped({ name: [{ family: "x".repeat(60), given: ["y".repeat(60)] }] })).toBe("mapped");
  });

  it("birth date: a full, real date from 1900 to today; partial or missing is incomplete", () => {
    expect(skipped({ birthDate: "1985-04" })).toBe("birthdate_incomplete");
    expect(skipped({ birthDate: "1985" })).toBe("birthdate_incomplete");
    expect(skipped({ birthDate: undefined })).toBe("birthdate_incomplete");
    expect(skipped({ birthDate: "1899-12-31" })).toBe("birthdate_invalid");
    expect(skipped({ birthDate: "1900-01-01" })).toBe("mapped");
    expect(skipped({ birthDate: "2026-09-29" })).toBe("birthdate_invalid");
    expect(skipped({ birthDate: "2026-09-28" })).toBe("mapped");
    expect(skipped({ birthDate: "2026-02-30" })).toBe("birthdate_invalid");
    expect(skipped({ birthDate: "1990-13-01" })).toBe("birthdate_invalid");
    expect(skipped({ birthDate: "not a date" })).toBe("birthdate_invalid");
  });

  it("every skip code is in the documented vocabulary", () => {
    const codes = [
      "resource_invalid",
      "id_invalid",
      "mrn_missing",
      "mrn_ambiguous",
      "mrn_invalid",
      "mrn_government_identifier",
      "mrn_looks_like_ssn",
      "mrn_looks_like_mbi",
      "name_incomplete",
      "name_invalid",
      "birthdate_incomplete",
      "birthdate_invalid",
    ];
    expect([...SKIP_CODES]).toEqual(codes);
    for (const code of codes) expect(code).toMatch(/^[a-z_]{1,64}$/);
  });
});

describe("mapPatient — sex", () => {
  it.each([
    ["female", "F"],
    ["male", "M"],
    ["other", "U"],
    ["unknown", "U"],
    [undefined, "U"],
    ["something-else", "U"],
  ])("gender %s -> %s (837P DMG03)", (gender, sex) => {
    expect(mapped({ gender }).patient.sex).toBe(sex);
  });
});

describe("mapPatient — address", () => {
  const address = (overrides: Record<string, unknown> = {}) => ({
    address: [
      { use: "home", line: ["100 Palm Way"], city: "Tampa", state: "FL", postalCode: "33601", ...overrides },
    ],
  });

  it("a valid home address maps; the state is upper-cased; ZIP+4 is allowed", () => {
    expect(mapped(address({ state: "fl", postalCode: "33601-1234" })).patient).toMatchObject({
      addressLine1: "100 Palm Way",
      city: "Tampa",
      state: "FL",
      postalCode: "33601-1234",
    });
  });

  it("an address with no use is treated as home; a work address is not used", () => {
    expect(mapped(address({ use: undefined })).patient.city).toBe("Tampa");
    const work = mapped(address({ use: "work" }));
    expect(work.patient.city).toBeNull();
    expect(work.notes).toContain("address_incomplete");
  });

  it("an address whose period ended is not current", () => {
    const old = mapped(address({ period: { end: "2020-01-01" } }));
    expect(old.patient.city).toBeNull();
    expect(mapped(address({ period: { start: "2020-01-01", end: "2027-01-01" } })).patient.city).toBe(
      "Tampa",
    );
  });

  it.each([
    { line: [] },
    { city: "" },
    { state: "Florida" },
    { state: "F1" },
    { postalCode: "3360" },
    { postalCode: "33601-12" },
    { line: ["x".repeat(56)] },
    { city: "c".repeat(31) },
    { line: ["Bad‮Line"] },
  ])("an invalid part (%o) nulls all four fields and notes address_incomplete", (overrides) => {
    const result = mapped(address(overrides));
    expect(result.patient).toMatchObject({ addressLine1: null, city: null, state: null, postalCode: null });
    expect(result.notes).toContain("address_incomplete");
  });

  it("no address at all is incomplete, and the record is still stored", () => {
    const result = mapped({ address: undefined });
    expect(result.patient.addressLine1).toBeNull();
    expect(result.notes).toContain("address_incomplete");
  });
});

describe("mapPatient — minors, status, labels, timestamps", () => {
  it("flags a patient under 18 today for review (the suggested minor tag), neutrally, and never sets anything itself", () => {
    expect(mapped({ birthDate: "2008-09-29" }).notes).toContain("review_required");
    expect(mapped({ birthDate: "2008-09-28" }).notes).not.toContain("review_required");
    expect(mapped({ birthDate: "2015-03-01" }).patient).not.toHaveProperty("sensitivityTags");
  });

  it("source status: inactive from Patient.active, merged from a replaced-by link (which wins)", () => {
    expect(mapped({ active: false }).patient.sourceStatus).toBe("inactive");
    expect(
      mapped({ link: [{ type: "replaced-by", other: { reference: "Patient/syn-2" } }] }).patient.sourceStatus,
    ).toBe("merged");
    expect(
      mapped({ active: false, link: [{ type: "replaced-by", other: { reference: "Patient/syn-2" } }] })
        .patient.sourceStatus,
    ).toBe("merged");
    expect(
      mapped({ link: [{ type: "refer", other: { reference: "Patient/syn-2" } }] }).patient.sourceStatus,
    ).toBeNull();
  });

  it("security labels mark the patient restricted, with codes from the fixed vocabulary only", () => {
    const labelled = mapped({
      meta: {
        versionId: "1",
        lastUpdated: "2026-09-01T00:00:00Z",
        security: [
          { system: "http://terminology.hl7.org/CodeSystem/v3-Confidentiality", code: "R" },
          { system: "https://vendor.example.test/x", code: "WHATEVER" },
        ],
      },
    });
    expect(labelled.patient).toMatchObject({ sourceRestricted: true, sourceSensitivity: ["R", "unknown"] });
  });

  it("server timestamps are clamped: a lastUpdated beyond five minutes ahead becomes our now", () => {
    expect(mapped({ meta: { lastUpdated: "2026-09-28T12:04:59.000Z" } }).patient.sourceLastUpdated).toEqual(
      new Date("2026-09-28T12:04:59.000Z"),
    );
    expect(mapped({ meta: { lastUpdated: "2026-09-28T12:05:01.000Z" } }).patient.sourceLastUpdated).toEqual(
      NOW,
    );
    expect(mapped({ meta: { lastUpdated: "2099-01-01T00:00:00Z" } }).patient.sourceLastUpdated).toEqual(NOW);
    expect(mapped({ meta: { lastUpdated: "garbage" } }).patient.sourceLastUpdated).toBeNull();
    expect(mapped({ meta: undefined }).patient.sourceLastUpdated).toBeNull();
  });

  it("keeps versionId only when it is FHIR id syntax", () => {
    expect(mapped({ meta: { versionId: "7" } }).patient.sourceVersionId).toBe("7");
    expect(mapped({ meta: { versionId: "not ok!" } }).patient.sourceVersionId).toBeNull();
  });
});

describe('mapPatient — "today" is the practice date, not the UTC date', () => {
  // 23:30 Eastern on 2026-09-28 is 03:30 UTC on 2026-09-29 (EDT is UTC-4).
  const lateEvening = new Date("2026-09-29T03:30:00.000Z");
  const late: MapPatientContext = {
    ...ctx,
    now: lateEvening,
    today: todayIn("America/New_York", lateEvening),
  };
  const mapLate = (overrides: Record<string, unknown>) => mapPatient(patient(overrides), late);

  it("the helper used by the sync gives the Eastern date (the UTC date would be a day ahead)", () => {
    expect(late.today).toBe("2026-09-28");
    expect(lateEvening.toISOString().slice(0, 10)).toBe("2026-09-29");
  });

  it("18th birthday: tomorrow is still a minor; today is not (day before, of, after)", () => {
    const notes = (birthDate: string) => {
      const result = mapLate({ birthDate });
      return result.ok ? result.notes : [`skipped:${result.code}`];
    };
    expect(notes("2008-09-29")).toContain("review_required");
    expect(notes("2008-09-28")).not.toContain("review_required");
    expect(notes("2008-09-27")).not.toContain("review_required");
  });

  it("a birth date of today is valid, of tomorrow is not (the UTC date would allow tomorrow)", () => {
    expect(mapLate({ birthDate: "2026-09-28" }).ok).toBe(true);
    expect(mapLate({ birthDate: "2026-09-29" })).toMatchObject({ ok: false, code: "birthdate_invalid" });
  });

  it("an address period ending today is current, one ending yesterday is not, one starting tomorrow is not", () => {
    const withPeriod = (period: Record<string, string>) =>
      mapLate({
        address: [
          { use: "home", line: ["1 Palm Way"], city: "Tampa", state: "FL", postalCode: "33601", period },
        ],
      });
    const city = (result: ReturnType<typeof mapLate>) => (result.ok ? result.patient.city : "skipped");
    expect(city(withPeriod({ end: "2026-09-28" }))).toBe("Tampa");
    expect(city(withPeriod({ end: "2026-09-27" }))).toBeNull();
    expect(city(withPeriod({ start: "2026-09-28" }))).toBe("Tampa");
    expect(city(withPeriod({ start: "2026-09-29" }))).toBeNull();
  });
});
