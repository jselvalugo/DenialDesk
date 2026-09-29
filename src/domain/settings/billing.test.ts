import { describe, expect, it } from "vitest";
import { validate837P, type Claim837Input } from "@/edi/x12/837p";
import { syntheticClaim } from "@/edi/x12/837p.fixture";
import {
  BILLING_LIMITS,
  cleanBillingText,
  cleanPlaceOfService,
  cleanPostalCode,
  cleanTin,
  validateProviderFields,
  type ProviderBillingInput,
} from "./billing";

// Pure validation for the billing settings page (docs/specs/claims.md C3a-S). Synthetic values only.

const VALID: ProviderBillingInput = {
  firstName: "Avery",
  lastName: "Synthprovider",
  addressLine1: "100 Synthetic Way",
  city: "Tampa",
  state: "FL",
  postalCode: "336020001",
  tinType: "EI",
  tin: "009182736",
};

function fieldsOf(input: Partial<ProviderBillingInput>): string[] {
  return validateProviderFields({ ...VALID, ...input }).issues.map((issue) => issue.field);
}

describe("cleanBillingText", () => {
  it("upper-cases, removes accents, and collapses blanks", () => {
    expect(cleanBillingText("  José   Núñez-Ortiz ", 35)).toEqual({ value: "JOSE NUNEZ-ORTIZ" });
  });

  it("accepts the limit and refuses one over, telling the limit and never the value", () => {
    expect(cleanBillingText("A".repeat(35), 35)).toEqual({ value: "A".repeat(35) });
    expect(cleanBillingText("A".repeat(36), 35)).toEqual({ key: "billing.error.tooLong", max: 35 });
  });

  it("refuses blank text", () => {
    expect(cleanBillingText("   ", 35)).toEqual({ key: "billing.error.required" });
  });

  it.each(["*", "~", ":", "^", "|", "\u0007", "中", "ß☃", "<", "@", "_"])(
    "refuses a character X12 can't carry (%j), never dropping it",
    (bad) => {
      expect(cleanBillingText(`AB${bad}CD`, 35)).toEqual({ key: "billing.error.characters" });
    },
  );

  it("keeps in step with the 837P generator: what the page stores, the generator accepts", () => {
    const generatorAccepts = (text: string) => {
      const input: Claim837Input = structuredClone(syntheticClaim());
      input.billingProvider.lastName = text;
      return !validate837P(input).some((issue) => issue.code === "invalid_character");
    };
    for (let code = 32; code < 127; code += 1) {
      const text = `A${String.fromCharCode(code)}B`;
      const cleaned = cleanBillingText(text, 60);
      if ("value" in cleaned) expect(generatorAccepts(cleaned.value), `char ${code}`).toBe(true);
      else expect(generatorAccepts(text), `char ${code}`).toBe(false);
    }
  });
});

describe("cleanPostalCode (providers_postal_code_shape)", () => {
  it.each([
    ["33602", "33602"],
    ["336020001", "336020001"],
    ["33602-0001", "336020001"],
    [" 33602 ", "33602"],
  ])("accepts %j", (raw, stored) => {
    expect(cleanPostalCode(raw)).toBe(stored);
  });

  it.each([
    "3360",
    "336020",
    "3360200",
    "33602000",
    "3360200012",
    "33602-",
    "33602-001",
    "3360a",
    "33 602",
    "",
  ])("refuses %j", (raw) => {
    expect(cleanPostalCode(raw)).toBeNull();
  });
});

describe("cleanTin", () => {
  it.each([
    ["009182736", "009182736"],
    ["00-9182736", "009182736"],
    ["009-18-2736", "009182736"],
    [" 009 18 2736 ", "009182736"],
  ])("accepts %j", (raw, stored) => {
    expect(cleanTin(raw)).toBe(stored);
  });

  it.each(["00918273", "0091827360", "00918273a", "", "00918273.6", "٠٠٩١٨٢٧٣٦"])("refuses %j", (raw) => {
    expect(cleanTin(raw)).toBeNull();
  });
});

describe("cleanPlaceOfService (locations_place_of_service_shape; format only, VERIFY against the CMS set)", () => {
  it.each(["11", "02", "99"])("accepts %j", (raw) => {
    expect(cleanPlaceOfService(raw)).toBe(raw);
  });

  it.each(["1", "111", "1a", "", "ab", " ", "1 1"])("refuses %j", (raw) => {
    expect(cleanPlaceOfService(raw)).toBeNull();
  });
});

describe("validateProviderFields", () => {
  it("accepts a complete synthetic provider and returns cleaned values", () => {
    const result = validateProviderFields({ ...VALID, city: "tampa", state: "fl", postalCode: "33602-0001" });
    expect(result.issues).toEqual([]);
    expect(result.values).toEqual({
      firstName: "AVERY",
      lastName: "SYNTHPROVIDER",
      addressLine1: "100 SYNTHETIC WAY",
      city: "TAMPA",
      state: "FL",
      postalCode: "336020001",
    });
  });

  it("reports every problem together, by field, with no value", () => {
    const result = validateProviderFields({
      firstName: "",
      lastName: "X".repeat(BILLING_LIMITS.lastName + 1),
      addressLine1: "1*2",
      city: "Tampa",
      state: "F",
      postalCode: "1234",
      tinType: "XX",
      tin: "12",
    });
    expect(result.issues.map((issue) => issue.field).sort()).toEqual(
      ["addressLine1", "firstName", "lastName", "postalCode", "state", "tin", "tinType"].sort(),
    );
    expect(JSON.stringify(result)).not.toContain("1*2");
  });

  it("checks lengths at the limit and one over", () => {
    for (const field of ["firstName", "lastName", "addressLine1", "city"] as const) {
      const limit = BILLING_LIMITS[field];
      expect(fieldsOf({ [field]: "A".repeat(limit) })).toEqual([]);
      expect(fieldsOf({ [field]: "A".repeat(limit + 1) })).toEqual([field]);
    }
  });

  it("checks state as two letters", () => {
    expect(fieldsOf({ state: "fl" })).toEqual([]);
    for (const state of ["", "F", "FLA", "F1", "1F"]) expect(fieldsOf({ state })).toEqual(["state"]);
  });

  it.each(["PO BOX 12", "P.O. Box 12", "P O BOX 7", "Post Office Box 9", "lockbox 4"])(
    "refuses a P.O. box: %s",
    (line) => {
      expect(validateProviderFields({ ...VALID, addressLine1: line }).issues).toEqual([
        { field: "addressLine1", key: "billing.error.poBox" },
      ]);
    },
  );

  it("takes the TIN type as EI, SY, or unset, and an empty TIN as 'leave alone'", () => {
    for (const tinType of ["EI", "SY", ""]) expect(fieldsOf({ tinType, tin: "" })).toEqual([]);
    expect(fieldsOf({ tinType: "ei" })).toEqual(["tinType"]);
    expect(fieldsOf({ tin: "12345678" })).toEqual(["tin"]);
    expect(fieldsOf({ tin: "1234567890" })).toEqual(["tin"]);
  });
});
