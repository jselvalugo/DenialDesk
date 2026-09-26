import { describe, expect, it } from "vitest";
import {
  agreementStatus,
  checkAgreementFile,
  EXPIRING_SOON_DAYS,
  MAX_AGREEMENT_BYTES,
  MAX_FILENAME_LENGTH,
  type AgreementDates,
} from "./agreements";

// docs/specs/practice-agreements.md: status from the agreements on file, with boundary days.
describe("agreementStatus", () => {
  const active = (effectiveDate: string, expiresOn: string | null): AgreementDates => ({
    status: "active",
    effectiveDate,
    expiresOn,
  });
  const superseded = (effectiveDate: string, expiresOn: string | null): AgreementDates => ({
    status: "superseded",
    effectiveDate,
    expiresOn,
  });
  const voided = (effectiveDate: string, expiresOn: string | null): AgreementDates => ({
    status: "voided",
    effectiveDate,
    expiresOn,
  });
  const historical = (effectiveDate: string, expiresOn: string | null): AgreementDates => ({
    status: "historical",
    effectiveDate,
    expiresOn,
  });
  const agreement = [active("2026-10-01", "2027-09-30")];

  it("is missing without an active agreement", () => {
    expect(agreementStatus([], "2026-10-15")).toBe("missing");
    expect(agreementStatus([superseded("2020-01-01", null)], "2026-10-15")).toBe("missing");
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

  it("ignores agreements recorded in error", () => {
    expect(agreementStatus([voided("2020-01-01", null)], "2026-10-15")).toBe("missing");
    // The renewal starts later; the voided predecessor no longer covers today.
    expect(agreementStatus([active("2027-01-01", null), voided("2026-01-01", null)], "2026-10-15")).toBe(
      "not_yet_effective",
    );
  });

  it("lets a historical (back-filled) agreement cover today until the active one starts", () => {
    expect(
      agreementStatus([active("2027-01-01", null), historical("2026-01-01", "2026-12-31")], "2026-10-15"),
    ).toBe("active");
  });

  it("stays active with no expiration date", () => {
    expect(agreementStatus([active("2026-10-01", null)], "2040-01-01")).toBe("active");
  });

  describe("a renewal recorded before it starts", () => {
    // The old agreement is superseded at once but still covers today until the renewal starts.
    const renewal = active("2027-10-01", "2028-09-30");
    const renewedSeamlessly = [renewal, superseded("2026-10-01", "2027-09-30")];

    it("keeps the practice active through the hand-over, with no expiring warning", () => {
      expect(agreementStatus(renewedSeamlessly, "2027-09-15")).toBe("active"); // inside 60 days of the old end
      expect(agreementStatus(renewedSeamlessly, "2027-09-30")).toBe("active"); // last day of the old one
      expect(agreementStatus(renewedSeamlessly, "2027-10-01")).toBe("active"); // first day of the renewal
    });

    it("warns when the renewal leaves a gap", () => {
      const withGap = [active("2027-10-05", null), superseded("2026-10-01", "2027-09-30")];
      expect(agreementStatus(withGap, "2027-09-15")).toBe("expiring");
      expect(agreementStatus(withGap, "2027-10-01")).toBe("not_yet_effective"); // the gap itself
      expect(agreementStatus(withGap, "2027-10-05")).toBe("active");
    });

    it("reports expired when the old one ended and the renewal never started coverage", () => {
      expect(
        agreementStatus(
          [active("2020-01-01", "2020-12-31"), superseded("2019-01-01", "2019-12-31")],
          "2026-01-01",
        ),
      ).toBe("expired");
    });
  });
});

describe("checkAgreementFile", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7 synthetic");
  const real = { syntheticOnly: false, attestedSynthetic: false };

  it("accepts a PDF by content and name", () => {
    expect(checkAgreementFile({ name: "Signed BAA.PDF", size: pdf.length, head: pdf, ...real })).toEqual({
      ok: true,
    });
  });

  it("rejects an empty file", () => {
    expect(checkAgreementFile({ name: "baa.pdf", size: 0, head: new Uint8Array(), ...real })).toMatchObject({
      ok: false,
    });
  });

  it("rejects a file over the cap", () => {
    expect(
      checkAgreementFile({ name: "baa.pdf", size: MAX_AGREEMENT_BYTES + 1, head: pdf, ...real }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("5 MB"),
    });
  });

  it("rejects a renamed non-PDF and a PDF with the wrong extension", () => {
    const text = new TextEncoder().encode("hello");
    expect(checkAgreementFile({ name: "baa.pdf", size: text.length, head: text, ...real })).toMatchObject({
      ok: false,
    });
    expect(checkAgreementFile({ name: "baa.docx", size: pdf.length, head: pdf, ...real })).toMatchObject({
      ok: false,
    });
  });

  it("rejects over-long names and control characters in names", () => {
    const long = `${"a".repeat(MAX_FILENAME_LENGTH)}.pdf`;
    expect(checkAgreementFile({ name: long, size: pdf.length, head: pdf, ...real })).toMatchObject({
      ok: false,
    });
    expect(checkAgreementFile({ name: "baa\r\n.pdf", size: pdf.length, head: pdf, ...real })).toMatchObject({
      ok: false,
    });
  });

  it("in synthetic-only environments needs the SYN- prefix and the attestation (ADR 0003)", () => {
    const syntheticOnly = { syntheticOnly: true };
    expect(
      checkAgreementFile({
        name: "Signed BAA.pdf",
        size: pdf.length,
        head: pdf,
        ...syntheticOnly,
        attestedSynthetic: true,
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("SYN-") });
    expect(
      checkAgreementFile({
        name: "SYN-baa.pdf",
        size: pdf.length,
        head: pdf,
        ...syntheticOnly,
        attestedSynthetic: false,
      }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("Confirm") });
    expect(
      checkAgreementFile({
        name: "syn-baa.pdf",
        size: pdf.length,
        head: pdf,
        ...syntheticOnly,
        attestedSynthetic: true,
      }),
    ).toEqual({ ok: true });
  });
});
