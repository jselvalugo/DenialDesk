import { describe, expect, it } from "vitest";
import { mapPatient } from "@/integrations/fhir/map-patient";
import { operationOutcomeCodes } from "@/integrations/fhir/types";
import {
  CONFLICT_CODES,
  STORE_REFUSAL_CODES,
  NOTE_CODES,
  OTHER_CODE,
  R4_ISSUE_TYPE_RUN_CODES,
  RUN_FAILURE_CODES,
  RUN_NOTICE_CODES,
  runCodeForIssueType,
  SKIP_CODES,
} from "@/integrations/fhir/sync-codes";
import { isSyncIssueCode, isSyncRunCode, normalizeIssueCode, normalizeRunCodes } from "./sync-codes";
import { SYNC_FAILURE_MESSAGE_KEYS, toSyncFailure } from "./sync";
import { FhirConnectError } from "@/integrations/fhir/outcomes";
import { SyncFailure } from "@/integrations/fhir/search";
import { SigningKeyStoreError } from "@/integrations/fhir/keys";
import { NotSyntheticError } from "@/integrations/fhir/synthetic-guard";
import { TransportError } from "@/integrations/fhir/errors";

// docs/specs/patient-integrations.md PI2b "Sync run and issue codes": run and issue codes come from a
// fixed allow-list defined in code; nothing from a remote server is stored verbatim; anything unknown is
// `other`; every code is lower-case snake_case and PHI-free (coordinator, 2026-09-28).

const SHAPE = /^[a-z_]{1,64}$/;

describe("the engine's additions to the allow-lists", () => {
  it("normalizers keep an allowed code, turn every other string into `other`, de-duplicate and sort", () => {
    expect(normalizeIssueCode("mrn_conflict")).toBe("mrn_conflict");
    expect(normalizeIssueCode("auth_refused")).toBe(OTHER_CODE);
    expect(normalizeIssueCode("Patient/123 is HIV positive")).toBe(OTHER_CODE);
    expect(
      normalizeRunCodes(["mrn_conflict", "zzz", "mrn_conflict", "not-found", "auth_refused", "abc"]),
    ).toEqual(["auth_refused", "mrn_conflict", "other"]);
    expect(normalizeRunCodes([])).toEqual([]);
  });

  it("the engine's code names follow the same PHI-free rule the list test enforces", () => {
    expect(NOTE_CODES).toContain("review_required");
    expect(NOTE_CODES as readonly string[]).not.toContain("minor_suggested");
  });
});

describe("every code the engine can write is in the list", () => {
  it("skip, note, conflict, notice, and failure codes", () => {
    for (const code of [...SKIP_CODES, ...NOTE_CODES, ...CONFLICT_CODES, ...STORE_REFUSAL_CODES])
      expect(isSyncIssueCode(code)).toBe(true);
    for (const code of [...RUN_NOTICE_CODES, ...RUN_FAILURE_CODES, ...R4_ISSUE_TYPE_RUN_CODES, OTHER_CODE]) {
      expect(isSyncRunCode(code), code).toBe(true);
    }
  });

  it("every code the mapper returns for a skipped record, and for a note", () => {
    const system = "https://ehr.example.test/mrn";
    const ctx = {
      mrnSystem: system,
      nineDigitsVerified: false,
      now: new Date("2026-09-28T12:00:00Z"),
      today: "2026-09-28",
    };
    const base = {
      resourceType: "Patient",
      id: "syn-1",
      identifier: [{ system, value: "SYN-1" }],
      name: [{ family: "Test", given: ["Fhira"] }],
      birthDate: "1990-01-01",
    };
    const variants: Record<string, unknown>[] = [
      {},
      { resourceType: "Practitioner" },
      { id: "bad id" },
      { identifier: [] },
      {
        identifier: [
          { system, value: "A" },
          { system, value: "B" },
        ],
      },
      { identifier: [{ system, value: "has space" }] },
      {
        identifier: [
          {
            system,
            value: "1",
            type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "SS" }] },
          },
        ],
      },
      { identifier: [{ system, value: "123-45-6789" }] },
      { identifier: [{ system, value: "1EG4TE5MK73" }] },
      { name: [] },
      { name: [{ family: "Ba​d", given: ["X"] }] },
      { birthDate: "1990-01" },
      { birthDate: "1899-01-01" },
      { birthDate: "2020-01-01" },
    ];
    const seen = new Set<string>();
    for (const variant of variants) {
      const result = mapPatient({ ...base, ...variant }, ctx);
      if (result.ok) result.notes.forEach((note) => seen.add(note));
      else seen.add(result.code);
    }
    // Every skip code is reachable from these inputs; every note as well.
    for (const code of SKIP_CODES) expect([...seen], code).toContain(code);
    for (const code of NOTE_CODES) expect([...seen], code).toContain(code);
    for (const code of seen) expect(isSyncIssueCode(code), code).toBe(true);
  });

  it("R4 issue codes from a server: ours if exactly an IssueType code, else `other`; never the remote string", () => {
    const codes = operationOutcomeCodes({
      resourceType: "OperationOutcome",
      issue: [
        { code: "not-found" },
        { code: "business-rule", diagnostics: "Patient Jane Q. Test, SSN 000-00-0000" },
        { code: "timeout" },
        { code: "Patient/123" },
        { code: "NOT-FOUND" },
        { code: "made-up" },
        {},
      ],
    });
    expect(codes).toEqual(["not_found", "business_rule", "timeout", "other"]);
    for (const code of codes) expect(isSyncRunCode(code)).toBe(true);
    expect(JSON.stringify(codes)).not.toMatch(/Jane|SSN|123/);
    expect(runCodeForIssueType("not-found")).toBe("not_found");
    expect(runCodeForIssueType("not_found")).toBe(OTHER_CODE);
    expect(runCodeForIssueType(undefined)).toBe(OTHER_CODE);
    expect(operationOutcomeCodes({ resourceType: "Patient" })).toEqual([]);
  });

  it("every failure the run can end with", () => {
    const failures: unknown[] = [
      new SyncFailure("issuer_mismatch"),
      new FhirConnectError("auth_refused"),
      new FhirConnectError("unreachable", "timeout"),
      new FhirConnectError("unreachable", "address_refused"),
      new FhirConnectError("unreachable"),
      new FhirConnectError("tls_failed", "tls_failed"),
      new FhirConnectError("not_fhir_r4"),
      new FhirConnectError("smart_config_invalid", "content_type_refused"),
      new FhirConnectError("capability_missing", undefined, "scope_insufficient"),
      ...(
        [
          "unreachable",
          "tls_failed",
          "address_refused",
          "redirect_refused",
          "content_type_refused",
          "too_large",
          "timeout",
          "paging_loop",
        ] as const
      ).map((code) => new TransportError(code)),
      new NotSyntheticError(),
      new SigningKeyStoreError("not_configured"),
      new Error("boom with PHI: Jane Test"),
      "a string",
    ];
    for (const error of failures) {
      const failure = toSyncFailure(error);
      expect(isSyncRunCode(failure.code), failure.code).toBe(true);
      expect(failure.code).toMatch(SHAPE);
    }
    expect(toSyncFailure(new Error("boom with PHI: Jane Test")).code).toBe("internal_error");
    expect(toSyncFailure(new FhirConnectError("auth_refused")).connectionError).toBe(true);
    expect(
      toSyncFailure(new FhirConnectError("auth_refused", undefined, undefined, { httpStatus: 401 })),
    ).toMatchObject({ code: "auth_refused", httpStatus: 401, connectionError: true });
    expect(
      toSyncFailure(new FhirConnectError("unreachable", undefined, undefined, { httpStatus: 503 }))
        .httpStatus,
    ).toBe(503);
    expect(toSyncFailure(new FhirConnectError("unreachable", "timeout")).code).toBe("timeout");
    expect(toSyncFailure(new FhirConnectError("unreachable")).code).toBe("unreachable");
    expect(toSyncFailure(new FhirConnectError("smart_config_invalid", "content_type_refused")).code).toBe(
      "smart_config_invalid",
    );
  });

  it("every failure code has a message, and no message key refers to a code that doesn't exist", () => {
    expect(Object.keys(SYNC_FAILURE_MESSAGE_KEYS).sort()).toEqual([...RUN_FAILURE_CODES].sort());
  });
});
