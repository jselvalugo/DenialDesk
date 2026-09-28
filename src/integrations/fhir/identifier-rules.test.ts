import { describe, expect, it } from "vitest";
import { isRefusedMrnIdentifierSystem } from "./identifier-rules";

describe("isRefusedMrnIdentifierSystem", () => {
  it.each([
    "http://hl7.org/fhir/sid/us-ssn",
    "urn:oid:2.16.840.1.113883.4.1",
    "http://hl7.org/fhir/sid/us-mbi",
    "http://hl7.org/fhir/sid/us-medicare",
    "urn:oid:2.16.840.1.113883.4.3.6", // a state driver's-license OID
    "http://hl7.org/fhir/sid/passport-usa",
  ])("refuses %s", (system) => {
    expect(isRefusedMrnIdentifierSystem(system)).toBe(true);
  });

  it.each(["http://hospital.example.org/mrn", "urn:oid:1.2.3.4.5.6.7", "http://hl7.org/fhir/sid/us-npi"])(
    "allows an ordinary MRN system %s",
    (system) => {
      expect(isRefusedMrnIdentifierSystem(system)).toBe(false);
    },
  );

  it("trims surrounding whitespace before comparing", () => {
    expect(isRefusedMrnIdentifierSystem("  http://hl7.org/fhir/sid/us-ssn  ")).toBe(true);
  });
});
