import { describe, expect, it } from "vitest";
import { checkMrnIdentifierSystem } from "./identifier-rules";

describe("checkMrnIdentifierSystem (PI1b)", () => {
  it.each([
    "http://hospital.example.org/mrn",
    "https://ehr.example.com/fhir/sid/mrn",
    "urn:oid:2.25.329800735698586629295641978511506172918",
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
    "urn:oid:2.16.840.1.113883.4.3",
    "http://hl7.org/fhir/sid/passport-USA",
    // Security review M-1: OID forms, member IDs, and spellings of listed URLs (⚠️ VERIFY OIDs).
    "urn:oid:2.16.840.1.113883.4.927",
    "URN:OID:2.16.840.1.113883.4.572",
    "urn:oid:2.16.840.1.113883.4.330.840",
    "http://hl7.org/fhir/sid/us-medicaid",
    "http://www.hl7.org/fhir/sid/us-ssn",
    "http://hl7.org:80/fhir/sid/us-mbi",
    "https://HL7.org/fhir/sid/us-ssn",
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
    // Spellings that would dodge the list are not plain URIs (security review M-1).
    ["http://hl7.org/fhir/sid/us-ssn#x", "invalid"],
    ["http://hl7.org/fhir/sid/us-ssn?", "invalid"],
    ["http://hl7.org/fhir/sid//us-ssn", "invalid"],
    ["http://hl7.org/fhir/sid/us-ss%6E", "invalid"],
    ["http://hl7.org/fhir/sid/x/../us-ssn", "invalid"],
    ["http://hl7.org:8080/fhir/sid/us-ssn", "invalid"],
    ["http://user@hl7.org/fhir/sid/us-ssn", "invalid"],
    ["http://hl7.org/fhir;v=1/sid/us-ssn", "invalid"],
    ["http://hl7.org./fhir/sid/us-ssn", "invalid"],
    // Invisible and bidi characters (security review L-4).
    ["http://ehr.example.com/m\u202ern", "invalid"],
    ["http://ehr.example.com/\u200bmrn", "invalid"],
    ["http://ehr.example.com/m\u2028rn", "invalid"],
    ["http://ehr.example.com/m\u00adrn", "invalid"],
  ])("refuses %j (%s)", (raw, code) => {
    expect(checkMrnIdentifierSystem(raw)).toEqual({ ok: false, code });
  });
});
