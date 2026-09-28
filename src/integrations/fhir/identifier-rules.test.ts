import { describe, expect, it } from "vitest";
import { checkMrnIdentifierSystem } from "./identifier-rules";

describe("checkMrnIdentifierSystem (PI1b)", () => {
  it.each([
    "http://hospital.example.org/mrn",
    "https://ehr.example.com/fhir/sid/mrn",
    "urn:oid:1.2.840.114350.1.13.0.1.7.5.737384.14",
    "urn:uuid:9b3a1c2e-1f4d-4c1a-9e7a-3a2b1c0d9e8f",
  ])("accepts a practice MRN system: %s", (system) => {
    expect(checkMrnIdentifierSystem(`  ${system} `)).toEqual({ ok: true, system });
  });

  it.each([
    "http://hl7.org/fhir/sid/us-ssn",
    "HTTPS://HL7.ORG/FHIR/SID/US-SSN/",
    "urn:oid:2.16.840.1.113883.4.1",
    "http://hl7.org/fhir/sid/us-mbi",
    "http://hl7.org/fhir/sid/us-medicare",
    "urn:oid:2.16.840.1.113883.4.3.12",
    "urn:oid:2.16.840.1.113883.4.3.25",
    "http://hl7.org/fhir/sid/passport-USA",
  ])("refuses a government or payer identifier system: %s", (system) => {
    expect(checkMrnIdentifierSystem(system)).toEqual({ ok: false, code: "government_identifier" });
  });

  it("does not refuse an OID that merely starts with the SSN OID's digits", () => {
    expect(checkMrnIdentifierSystem("urn:oid:2.16.840.1.113883.4.10")).toMatchObject({ ok: true });
  });

  it.each([
    ["", "invalid"],
    ["MRN", "invalid"],
    ["urn:oid:not.an.oid", "invalid"],
    ["http://has space.example/mrn", "invalid"],
    [`http://example.com/${"a".repeat(260)}`, "too_long"],
  ])("refuses %j (%s)", (raw, code) => {
    expect(checkMrnIdentifierSystem(raw)).toEqual({ ok: false, code });
  });
});
