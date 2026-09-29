import { describe, expect, it } from "vitest";
import { todayIn } from "@rules/calendar";
import { beneficiaryId, memberIdOf, organizationKey, selectPrimaryCoverage } from "./map-coverage";
import type { CoverageResource } from "./types";

// docs/specs/patient-integrations.md "Field mapping": primary Coverage = active, beneficiary this
// patient, period covering today, lowest `order`, relationship `self`; ties with no `order`,
// dependents, or a non-Organization payor -> `needs_review`, no payer, no member ID. Synthetic data.

const TODAY = "2026-09-28";
const PATIENT = "syn-1";
const RELATIONSHIP = "http://terminology.hl7.org/CodeSystem/subscriber-relationship";
const V2_0203 = "http://terminology.hl7.org/CodeSystem/v2-0203";

function coverage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    resourceType: "Coverage",
    id: "cov-1",
    status: "active",
    identifier: [{ type: { coding: [{ system: V2_0203, code: "MB" }] }, value: "SYN-MBR-0001" }],
    subscriberId: "SYN-SUB-0001",
    beneficiary: { reference: `Patient/${PATIENT}` },
    relationship: { coding: [{ system: RELATIONSHIP, code: "self" }] },
    period: { start: "2026-01-01" },
    order: 1,
    payor: [{ reference: "Organization/org-1", display: "Synthetic Health Plan A" }],
    ...overrides,
  };
}
const select = (...coverages: Record<string, unknown>[]) => selectPrimaryCoverage(coverages, PATIENT, TODAY);

describe("selectPrimaryCoverage", () => {
  it("a usable coverage: payor key, name, and the MB identifier as the member ID (before subscriberId)", () => {
    expect(select(coverage())).toEqual({
      status: "unmapped",
      payorKey: "Organization/org-1",
      payorName: "Synthetic Health Plan A",
      memberId: "SYN-MBR-0001",
    });
  });

  it("falls back to subscriberId when there is no MB identifier", () => {
    expect(select(coverage({ identifier: [] })).memberId).toBe("SYN-SUB-0001");
    expect(select(coverage({ identifier: [{ value: "OTHER" }] })).memberId).toBe("SYN-SUB-0001");
  });

  it("no coverage at all, or none that qualifies, is `none`", () => {
    expect(select().status).toBe("none");
    expect(select(coverage({ status: "cancelled" })).status).toBe("none");
    expect(select(coverage({ status: undefined })).status).toBe("none");
    expect(select(coverage({ beneficiary: { reference: "Patient/someone-else" } })).status).toBe("none");
    expect(select({ resourceType: "Patient", id: "x" }).status).toBe("none");
  });

  it("the period must cover today: a boundary on either side counts, a day outside does not", () => {
    expect(select(coverage({ period: { start: TODAY } })).status).toBe("unmapped");
    expect(select(coverage({ period: { end: TODAY } })).status).toBe("unmapped");
    expect(select(coverage({ period: { start: "2026-09-29" } })).status).toBe("none");
    expect(select(coverage({ period: { end: "2026-09-27" } })).status).toBe("none");
    expect(select(coverage({ period: undefined })).status).toBe("unmapped");
    expect(
      select(coverage({ period: { start: "2026-01-01T00:00:00Z", end: "2026-12-31T23:59:59Z" } })).status,
    ).toBe("unmapped");
    // A bound that isn't a date makes the period unusable rather than open.
    expect(select(coverage({ period: { start: "yesterday" } })).status).toBe("none");
  });

  it("the lowest `order` wins whatever the list order", () => {
    const secondary = coverage({ id: "cov-2", order: 2, payor: [{ reference: "Organization/org-2" }] });
    expect(select(secondary, coverage()).payorKey).toBe("Organization/org-1");
    expect(select(coverage(), secondary).payorKey).toBe("Organization/org-1");
  });

  it("a tie at the lowest order, including several with no order, needs review", () => {
    expect(select(coverage(), coverage({ id: "cov-2" })).status).toBe("needs_review");
    expect(select(coverage({ order: undefined }), coverage({ id: "cov-2", order: undefined })).status).toBe(
      "needs_review",
    );
    // A single coverage with no order is fine; an ordered one beats an unordered one.
    expect(select(coverage({ order: undefined })).status).toBe("unmapped");
    expect(
      select(coverage({ order: undefined, payor: [{ reference: "Organization/org-9" }] }), coverage())
        .payorKey,
    ).toBe("Organization/org-1");
  });

  it("a review outcome carries no payer, no payor key, and no member ID", () => {
    expect(select(coverage(), coverage({ id: "cov-2" }))).toEqual({
      status: "needs_review",
      payorKey: null,
      payorName: null,
      memberId: null,
    });
  });

  it("dependents, and a missing relationship, need review (OA-055)", () => {
    expect(
      select(coverage({ relationship: { coding: [{ system: RELATIONSHIP, code: "child" }] } })).status,
    ).toBe("needs_review");
    expect(select(coverage({ relationship: undefined })).status).toBe("needs_review");
    expect(
      select(coverage({ relationship: { coding: [{ system: "https://x.test", code: "self" }] } })).status,
    ).toBe("needs_review");
  });

  it("a payor that is not a single Organization reference needs review", () => {
    expect(select(coverage({ payor: [{ reference: `Patient/${PATIENT}` }] })).status).toBe("needs_review");
    expect(select(coverage({ payor: [{ reference: "RelatedPerson/r1" }] })).status).toBe("needs_review");
    expect(select(coverage({ payor: [{ reference: "#contained" }] })).status).toBe("needs_review");
    expect(select(coverage({ payor: [{ display: "No reference" }] })).status).toBe("needs_review");
    expect(select(coverage({ payor: [] })).status).toBe("needs_review");
    expect(
      select(coverage({ payor: [{ reference: "Organization/a" }, { reference: "Organization/b" }] })).status,
    ).toBe("needs_review");
  });

  it("a payor key that breaks the storage rules is never used: over-long, or with an invisible character", () => {
    for (const reference of [
      `Organization/${"a".repeat(65)}`,
      "Organization/org\u200b1",
      "Organization/org\u202e1",
      "Organization/org 1",
    ]) {
      expect(select(coverage({ payor: [{ reference }] }))).toEqual({
        status: "needs_review",
        payorKey: null,
        payorName: null,
        memberId: null,
      });
    }
  });

  it("no usable member ID needs review, because a mapped or unmapped coverage must carry one", () => {
    expect(select(coverage({ identifier: [], subscriberId: undefined })).status).toBe("needs_review");
    expect(select(coverage({ identifier: [], subscriberId: "  " })).status).toBe("needs_review");
    expect(select(coverage({ identifier: [], subscriberId: "x".repeat(65) })).status).toBe("needs_review");
    expect(select(coverage({ identifier: [], subscriberId: "bad​id" })).status).toBe("needs_review");
  });

  it("an absolute payor URL is reduced to Organization/<id>; the display name is optional and bounded", () => {
    const usable = select(
      coverage({ payor: [{ reference: "https://ehr.example.test/r4/Organization/org-7/_history/2" }] }),
    );
    expect(usable).toMatchObject({ payorKey: "Organization/org-7", payorName: null });
    expect(
      select(coverage({ payor: [{ reference: "Organization/o", display: "x".repeat(201) }] })).payorName,
    ).toBeNull();
  });
});

describe("helpers", () => {
  it("beneficiaryId reads Patient/<id> in relative and absolute form", () => {
    const of = (reference: string) =>
      beneficiaryId({ resourceType: "Coverage", beneficiary: { reference } } as CoverageResource);
    expect(of("Patient/p1")).toBe("p1");
    expect(of("https://ehr.example.test/r4/Patient/p1")).toBe("p1");
    expect(of("Organization/p1")).toBeNull();
    expect(of("Patient/has space")).toBeNull();
  });

  it("organizationKey and memberIdOf", () => {
    expect(organizationKey("Organization/abc")).toBe("Organization/abc");
    expect(organizationKey("Patient/abc")).toBeNull();
    expect(organizationKey(undefined)).toBeNull();
    expect(memberIdOf({ resourceType: "Coverage", subscriberId: " ABC 123 " })).toBe("ABC 123");
  });
});

describe("selectPrimaryCoverage — the practice's date at 23:30 Eastern (PR #98 review)", () => {
  // 23:30 Eastern on 2026-09-28 is 03:30 UTC on 2026-09-29: the UTC date is a day ahead.
  const evening = new Date("2026-09-29T03:30:00.000Z");
  const today = todayIn("America/New_York", evening);
  const selectLate = (...coverages: Record<string, unknown>[]) =>
    selectPrimaryCoverage(coverages, PATIENT, today);

  it("uses the Eastern date, not the UTC date", () => {
    expect(today).toBe("2026-09-28");
    expect(evening.toISOString().slice(0, 10)).toBe("2026-09-29");
  });

  it("a period ending today still covers today; one starting tomorrow does not; one ending yesterday does not", () => {
    expect(selectLate(coverage({ period: { end: "2026-09-28" } })).status).toBe("unmapped");
    expect(selectLate(coverage({ period: { start: "2026-09-28" } })).status).toBe("unmapped");
    expect(selectLate(coverage({ period: { start: "2026-09-29" } })).status).toBe("none");
    expect(selectLate(coverage({ period: { end: "2026-09-27" } })).status).toBe("none");
  });
});
