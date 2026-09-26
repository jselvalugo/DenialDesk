import { describe, expect, it } from "vitest";
import { agreementStatus, checkAgreementFile, EXPIRING_SOON_DAYS, MAX_AGREEMENT_BYTES } from "./agreements";

// docs/specs/practice-agreements.md: status from the active agreement's dates, with boundary days.
describe("agreementStatus", () => {
  const agreement = { effectiveDate: "2026-10-01", expiresOn: "2027-09-30" };

  it("is missing without an active agreement", () => {
    expect(agreementStatus(null, "2026-10-15")).toBe("missing");
    expect(agreementStatus(undefined, "2026-10-15")).toBe("missing");
  });

  it.each([
    ["2026-09-30", "not_yet_effective"],
    ["2026-10-01", "active"],
    ["2026-10-02", "active"],
  ] as const)("effective date boundary: %s → %s", (today, status) => {
    expect(agreementStatus(agreement, today)).toBe(status);
  });

  it.each([
    ["2027-09-29", "expiring"],
    ["2027-09-30", "expiring"],
    ["2027-10-01", "expired"],
  ] as const)("expiration boundary: %s → %s", (today, status) => {
    expect(agreementStatus(agreement, today)).toBe(status);
  });

  it(`turns to expiring ${EXPIRING_SOON_DAYS} days before expiration, not the day before that`, () => {
    // 2027-09-30 minus 60 days is 2027-08-01.
    expect(agreementStatus(agreement, "2027-07-31")).toBe("active");
    expect(agreementStatus(agreement, "2027-08-01")).toBe("expiring");
  });

  it("stays active with no expiration date", () => {
    expect(agreementStatus({ effectiveDate: "2026-10-01", expiresOn: null }, "2040-01-01")).toBe("active");
  });
});

describe("checkAgreementFile", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7 synthetic");

  it("accepts a PDF by content and name", () => {
    expect(checkAgreementFile({ name: "Synthetic BAA.PDF", size: pdf.length, head: pdf })).toEqual({
      ok: true,
    });
  });

  it("rejects an empty file", () => {
    expect(checkAgreementFile({ name: "baa.pdf", size: 0, head: new Uint8Array() })).toMatchObject({
      ok: false,
    });
  });

  it("rejects a file over the cap", () => {
    expect(checkAgreementFile({ name: "baa.pdf", size: MAX_AGREEMENT_BYTES + 1, head: pdf })).toMatchObject({
      ok: false,
      error: expect.stringContaining("5 MB"),
    });
  });

  it("rejects a renamed non-PDF and a PDF with the wrong extension", () => {
    const text = new TextEncoder().encode("hello");
    expect(checkAgreementFile({ name: "baa.pdf", size: text.length, head: text })).toMatchObject({
      ok: false,
    });
    expect(checkAgreementFile({ name: "baa.docx", size: pdf.length, head: pdf })).toMatchObject({
      ok: false,
    });
  });
});
