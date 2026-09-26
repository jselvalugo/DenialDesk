import { describe, expect, it } from "vitest";
import { changedPatientFields, nextMrn, patientSchema, type StoredPatient } from "./record";

const today = "2026-09-26";
const payerId = "0b8c8a8e-4d1c-4c5e-9a3b-0f6f1a2b3c4d";
const valid = {
  mrn: "",
  firstName: "Avery",
  lastName: "O'Neil-Reyes",
  birthDate: "1980-04-02",
  sex: "F",
  addressLine1: " 12 Synthetic Way ",
  city: "Tampa",
  state: "fl",
  postalCode: "33606",
  phone: "(813) 555-0100",
  primaryPayerId: payerId,
  memberId: "syn123456789",
  sensitivityTags: ["sud", "hiv", "sud"],
};

const schema = (syntheticOnly = true) => patientSchema({ today, syntheticOnly });

describe("patient record input", () => {
  it("normalizes a valid record", () => {
    const parsed = schema().parse(valid);
    expect(parsed).toMatchObject({
      mrn: null,
      state: "FL",
      addressLine1: "12 Synthetic Way",
      phone: "813-555-0100",
      memberId: "SYN123456789",
      sensitivityTags: ["hiv", "sud"],
    });
  });

  it("treats blank optional fields as not given", () => {
    const parsed = schema().parse({ ...valid, city: "  ", phone: "", primaryPayerId: "", memberId: "" });
    expect(parsed).toMatchObject({ city: null, phone: null, primaryPayerId: null, memberId: null });
  });

  it.each([
    ["date of birth tomorrow", { birthDate: "2026-09-27" }, "can't be in the future"],
    ["impossible date", { birthDate: "2026-02-30" }, "valid date of birth"],
    ["date before 1900", { birthDate: "1899-12-31" }, "after 1900"],
    ["unknown sex", { sex: "X" }, "sex"],
    ["state name", { state: "Florida" }, "two-letter state"],
    ["short ZIP", { postalCode: "3360" }, "ZIP"],
    ["short phone", { phone: "555-0100" }, "10-digit"],
    ["digits in a name", { firstName: "Av3ry" }, "letters"],
    ["member ID without a payer", { primaryPayerId: "" }, "payer this member ID belongs to"],
    ["unknown sensitivity tag", { sensitivityTags: ["vip"] }, ""],
  ])("rejects %s", (_, override, message) => {
    const result = schema().safeParse({ ...valid, ...override });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.message).join(" ")).toContain(message);
  });

  it("accepts a date of birth of today", () => {
    expect(schema().safeParse({ ...valid, birthDate: today }).success).toBe(true);
  });

  it("requires the SYN prefix on MRNs and member IDs in synthetic-only environments (R-15.1)", () => {
    const result = schema().safeParse({ ...valid, mrn: "A-100", memberId: "W123456789" });
    expect(result.error!.issues.map((i) => i.path[0])).toEqual(["mrn", "memberId"]);
    expect(schema(false).safeParse({ ...valid, mrn: "A-100", memberId: "W123456789" }).success).toBe(true);
  });

  it("never echoes the rejected value", () => {
    const result = schema().safeParse({ ...valid, memberId: "W987654321" });
    expect(JSON.stringify(result.error!.issues)).not.toContain("W987654321");
  });
});

describe("changed patient fields", () => {
  const stored: StoredPatient = {
    mrn: "SYN-001000",
    firstName: "Avery",
    lastName: "O'Neil-Reyes",
    birthDate: "1980-04-02",
    sex: "F",
    addressLine1: "12 Synthetic Way",
    city: "Tampa",
    state: "FL",
    postalCode: "33606",
    phone: "813-555-0100",
    primaryPayerId: payerId,
    sensitivityTags: ["sud", "hiv"],
  };

  it("reports nothing when only blank MRN and member ID are submitted", () => {
    expect(changedPatientFields(stored, schema().parse({ ...valid, memberId: "" }))).toEqual([]);
  });

  it("lists changed field names, and a new member ID", () => {
    const input = schema().parse({ ...valid, city: "Orlando", memberId: "SYN555", sensitivityTags: [] });
    expect(changedPatientFields(stored, input)).toEqual(["city", "memberId", "sensitivityTags"]);
  });

  it("counts a re-entered member ID as a change (only the last 4 are stored in clear)", () => {
    expect(changedPatientFields(stored, schema().parse(valid))).toEqual(["memberId"]);
  });
});

describe("generated MRNs", () => {
  it("continues after the highest synthetic MRN", () => {
    expect(nextMrn(["SYN-001079", "SYN-001002", "OTHER-9"], true)).toBe("SYN-001080");
  });

  it("starts at 1 for an empty practice", () => {
    expect(nextMrn([], true)).toBe("SYN-000001");
    expect(nextMrn([], false)).toBe("MRN-000001");
  });
});
