import { describe, expect, it } from "vitest";
import {
  canCorrectClaims,
  canEditPatients,
  canEditPayerFields,
  canGenerateClaimFile,
  canImportCharges,
  canManageAppealTemplates,
  canWorkAppeals,
  canTagSensitivity,
  canViewUniversity,
  canWorkDenials,
} from "./permissions";

describe("claim corrections (R-5.1.2, R-3.10.1)", () => {
  it.each([
    ["admin", true],
    ["manager", true],
    ["specialist", true],
    ["compliance", false],
  ] as const)("%s can correct claims: %s", (role, allowed) => {
    expect(canCorrectClaims(role)).toBe(allowed);
  });
});

describe("charge import (R-5.1.2, docs/specs/claims.md C2)", () => {
  it.each([
    ["admin", true],
    ["manager", true],
    ["specialist", true],
    ["compliance", false],
  ] as const)("%s can import charges: %s", (role, allowed) => {
    expect(canImportCharges(role)).toBe(allowed);
  });
});

describe("837P generation (R-5.1.2, R-3.10.1)", () => {
  it.each([
    ["admin", true],
    ["manager", true],
    ["specialist", true],
    ["compliance", false],
  ] as const)("%s can generate a claim file: %s", (role, allowed) => {
    expect(canGenerateClaimFile(role)).toBe(allowed);
  });
});

describe("patient records (R-5.1.2, R-3.5.1)", () => {
  it.each([
    ["admin", true, true],
    ["manager", true, false],
    ["specialist", true, false],
    ["compliance", false, false],
  ] as const)("%s edits patients: %s, tags sensitivity: %s", (role, edit, tag) => {
    expect(canEditPatients(role)).toBe(edit);
    expect(canTagSensitivity(role)).toBe(tag);
  });
});

describe("payer custom fields (docs/specs/settings-and-custom-fields.md S2 PR4)", () => {
  it.each([
    ["admin", true],
    ["manager", true],
    ["specialist", false],
    ["compliance", false],
  ] as const)("%s can edit a payer's custom fields: %s", (role, allowed) => {
    expect(canEditPayerFields(role)).toBe(allowed);
  });

  it("every role that can edit payer fields can also reveal a locked value (canWorkDenials is a superset)", () => {
    for (const role of ["admin", "manager"] as const) {
      expect(canEditPayerFields(role)).toBe(true);
      expect(canWorkDenials(role)).toBe(true);
    }
  });
});

describe("appeal letters (R-5.1.2, docs/specs/appeals.md A2)", () => {
  it.each([
    ["admin", true],
    ["manager", true],
    ["specialist", true],
    ["compliance", false],
  ] as const)("%s can edit, attest, and export a letter: %s", (role, allowed) => {
    expect(canWorkAppeals(role)).toBe(allowed);
  });

  it.each([
    ["admin", true],
    ["manager", true],
    ["specialist", false],
    ["compliance", false],
  ] as const)("%s can edit letter templates: %s", (role, allowed) => {
    expect(canManageAppealTemplates(role)).toBe(allowed);
  });
});

describe("university wiki (R-10.4)", () => {
  it.each(["admin", "manager", "specialist", "compliance"] as const)("%s can read the wiki", (role) => {
    expect(canViewUniversity(role)).toBe(true);
  });
});
