import { describe, expect, it } from "vitest";
import { assertSyntheticPage, isNotSyntheticError, NotSyntheticError } from "./synthetic-guard";

// docs/specs/patient-integrations.md "Environment and population rules": where only synthetic data is
// allowed, every raw MRN and member ID must start with `SYN`, checked on the raw page before any
// transform; one failing value fails the whole page. There is no prefixing on ingest.

const SYSTEM = "https://ehr.example.test/mrn";
const V2_0203 = "http://terminology.hl7.org/CodeSystem/v2-0203";
const patient = (value: unknown, system = SYSTEM) => ({
  resourceType: "Patient",
  identifier: [{ system, value }],
});
const coverage = (fields: Record<string, unknown>) => ({ resourceType: "Coverage", ...fields });
const mb = (value: unknown) => ({ type: { coding: [{ system: V2_0203, code: "MB" }] }, value });

describe("assertSyntheticPage", () => {
  it("passes a page whose MRNs and member IDs all start with SYN", () => {
    expect(() =>
      assertSyntheticPage(
        [patient("SYN-0000001"), patient("SYN-0000002")],
        [coverage({ subscriberId: "SYN-MBR-1", identifier: [mb("SYN-MBR-1")] })],
        SYSTEM,
      ),
    ).not.toThrow();
  });

  it("refuses one MRN without the marker, and says nothing about it", () => {
    let caught: unknown;
    try {
      assertSyntheticPage([patient("SYN-1"), patient("REAL-LOOKING-123")], [], SYSTEM);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NotSyntheticError);
    expect(isNotSyntheticError(caught)).toBe(true);
    expect((caught as Error).message).toBe("not_synthetic");
    expect(JSON.stringify(caught)).not.toContain("REAL");
  });

  it("is case-sensitive and requires the marker at the start", () => {
    expect(() => assertSyntheticPage([patient("syn-1")], [], SYSTEM)).toThrow(NotSyntheticError);
    expect(() => assertSyntheticPage([patient("X-SYN-1")], [], SYSTEM)).toThrow(NotSyntheticError);
  });

  it("refuses an unmarked subscriberId or MB member ID", () => {
    expect(() => assertSyntheticPage([], [coverage({ subscriberId: "W123" })], SYSTEM)).toThrow(
      NotSyntheticError,
    );
    expect(() => assertSyntheticPage([], [coverage({ identifier: [mb("W123")] })], SYSTEM)).toThrow(
      NotSyntheticError,
    );
  });

  it("a value that is present but not a string fails; an absent one is left to the mapper", () => {
    expect(() => assertSyntheticPage([patient(12345)], [], SYSTEM)).toThrow(NotSyntheticError);
    expect(() => assertSyntheticPage([{ resourceType: "Patient" }], [], SYSTEM)).not.toThrow();
    expect(() => assertSyntheticPage([patient(undefined)], [], SYSTEM)).not.toThrow();
  });

  it("only identifiers the sync would ingest are checked: another system, or a non-MB coverage identifier", () => {
    expect(() =>
      assertSyntheticPage([patient("W1", "https://other.example.test/id")], [], SYSTEM),
    ).not.toThrow();
    expect(() =>
      assertSyntheticPage(
        [],
        [coverage({ identifier: [{ system: "https://x.test", value: "W1" }] })],
        SYSTEM,
      ),
    ).not.toThrow();
  });

  it("reads defensively: junk shapes don't throw anything but the guard's own error", () => {
    expect(() =>
      assertSyntheticPage(
        ["x", null, 3, { identifier: "no" }] as never,
        [undefined, [], {}] as never,
        SYSTEM,
      ),
    ).not.toThrow();
  });
});
