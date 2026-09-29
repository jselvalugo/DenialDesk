import { describe, expect, it } from "vitest";
import type { TenantTx } from "@/db/tenant";
import {
  emptyWarnings,
  isSameService,
  matchPayer,
  serviceKeys,
  tallyWarnings,
  type ServiceIdentity,
} from "./charge-import";
import { createDraftClaims } from "./versions";

const payer = (id: string, name: string, verified = true) => ({ id, name, verified });

describe("payer match (docs/specs/claims.md C2)", () => {
  const catalog = [
    payer("p1", "Gulf Coast Mutual (synthetic)"),
    payer("p2", "Sunward HMO (synthetic)", false),
  ];

  it("matches by name, trimmed and case-insensitively", () => {
    expect(matchPayer(catalog, "  gulf coast MUTUAL (synthetic) ")).toEqual({
      status: "matched",
      payer: catalog[0],
    });
  });

  it("allows an unverified payer (the import warns; C3 refuses to submit it)", () => {
    expect(matchPayer(catalog, "Sunward HMO (synthetic)")).toEqual({ status: "matched", payer: catalog[1] });
  });

  it("never treats a blank or unknown name as a payer, and never as self-pay", () => {
    expect(matchPayer(catalog, "")).toEqual({ status: "not_found" });
    expect(matchPayer(catalog, "   ")).toEqual({ status: "not_found" });
    expect(matchPayer(catalog, "Nobody Health")).toEqual({ status: "not_found" });
    // A partial name is not a match.
    expect(matchPayer(catalog, "Gulf Coast")).toEqual({ status: "not_found" });
  });

  it("lets the verified payer win a name tie, as the patient form does", () => {
    const tied = [payer("a", "Same Name", false), payer("b", "Same Name", true)];
    expect(matchPayer(tied, "same name")).toEqual({ status: "matched", payer: tied[1] });
  });

  it("refuses two payers it can't tell apart instead of picking one", () => {
    expect(matchPayer([payer("a", "Same Name"), payer("b", "same name")], "Same Name")).toEqual({
      status: "ambiguous",
    });
    expect(matchPayer([payer("a", "Same Name", false), payer("b", "Same Name", false)], "Same Name")).toEqual(
      { status: "ambiguous" },
    );
  });
});

describe("duplicate rule: same patient, payer, date, and code with the same modifiers", () => {
  const identity = (
    over: Partial<ServiceIdentity> & { lines?: { procedureCode: string; modifiers: string[] }[] },
  ) => ({
    patientId: "pt1",
    payerId: "p1",
    serviceDate: "2026-09-14",
    keys: serviceKeys(over.lines ?? [{ procedureCode: "99213", modifiers: [] }]),
    ...over,
  });

  it("matches on one shared procedure-and-modifiers pair among several", () => {
    const existing = identity({
      lines: [
        { procedureCode: "99214", modifiers: ["25"] },
        { procedureCode: "36415", modifiers: [] },
      ],
    });
    const incoming = identity({ lines: [{ procedureCode: "36415", modifiers: [] }] });
    expect(isSameService(incoming, existing)).toBe(true);
  });

  it("does not match when only the modifiers differ", () => {
    const a = identity({ lines: [{ procedureCode: "99213", modifiers: ["25"] }] });
    const b = identity({ lines: [{ procedureCode: "99213", modifiers: [] }] });
    const c = identity({ lines: [{ procedureCode: "99213", modifiers: ["59"] }] });
    expect(isSameService(a, b)).toBe(false);
    expect(isSameService(a, c)).toBe(false);
  });

  it("compares modifiers regardless of order, without reordering anything stored", () => {
    const stored = [{ procedureCode: "99213", modifiers: ["59", "25"] }];
    const a = identity({ lines: stored });
    const b = identity({ lines: [{ procedureCode: "99213", modifiers: ["25", "59"] }] });
    expect(isSameService(a, b)).toBe(true);
    expect(stored[0]!.modifiers).toEqual(["59", "25"]);
  });

  it.each([
    ["another patient", { patientId: "pt2" }],
    ["another payer", { payerId: "p2" }],
    ["the day after", { serviceDate: "2026-09-15" }],
    ["the day before", { serviceDate: "2026-09-13" }],
  ])("does not match %s", (_, override) => {
    expect(isSameService(identity({}), identity(override))).toBe(false);
  });

  it("does not match a different procedure code", () => {
    const a = identity({ lines: [{ procedureCode: "99213", modifiers: [] }] });
    const b = identity({ lines: [{ procedureCode: "99214", modifiers: [] }] });
    expect(isSameService(a, b)).toBe(false);
  });
});

describe("warnings from the timely-filing rule (R-3.1.5): warn only", () => {
  const base = { payerVerified: true, noCoverage: false, patientInactive: false };
  // Florida: 6 months from 2026-03-31 is 2026-09-30 (fl.timely_filing.initial, ⚠️ VERIFY).
  it.each([
    ["2026-09-29", { dueSoon: 1, pastDeadline: 0 }], // deadline tomorrow: open, due soon
    ["2026-09-30", { dueSoon: 1, pastDeadline: 0 }], // deadline today: open, due today
    ["2026-10-01", { dueSoon: 0, pastDeadline: 1 }], // deadline yesterday: past
  ])("Florida claim, today %s", (today, expected) => {
    const warnings = emptyWarnings();
    tallyWarnings(warnings, { ...base, regime: "fl_insurer", serviceDate: "2026-03-31", today });
    expect(warnings).toMatchObject(expected);
  });

  it("counts a claim outside the 30-day window as no warning at all", () => {
    const warnings = emptyWarnings();
    tallyWarnings(warnings, { ...base, regime: "fl_hmo", serviceDate: "2026-09-14", today: "2026-09-29" });
    expect(warnings).toEqual(emptyWarnings());
  });

  it("counts regimes with no configured filing rule, never guessing a deadline", () => {
    const warnings = emptyWarnings();
    tallyWarnings(warnings, {
      ...base,
      regime: "erisa_self_funded",
      serviceDate: "2026-03-31",
      today: "2026-09-29",
    });
    expect(warnings).toMatchObject({ notConfigured: 1, pastDeadline: 0, dueSoon: 0 });
  });

  it("counts unverified payers, missing coverage, and inactive patients", () => {
    const warnings = emptyWarnings();
    tallyWarnings(warnings, {
      regime: null,
      serviceDate: "2026-09-14",
      today: "2026-09-29",
      payerVerified: false,
      noCoverage: true,
      patientInactive: true,
    });
    expect(warnings).toEqual({
      pastDeadline: 0,
      dueSoon: 0,
      notConfigured: 0,
      payerUnverified: 1,
      noCoverage: 1,
      patientInactive: 1,
    });
  });
});

describe("createDraftClaims refuses malformed input before touching the database", () => {
  const draft = {
    claimNumber: "SYN-X-1",
    patientId: "00000000-0000-4000-8000-000000000001",
    providerId: "00000000-0000-4000-8000-000000000002",
    locationId: "00000000-0000-4000-8000-000000000003",
    payerId: "00000000-0000-4000-8000-000000000004",
    serviceDate: "2026-09-14",
    diagnosisCodes: ["E11.9"],
  };
  const actor = { tenantId: "t", userId: "u" };
  const tx = {} as TenantTx;

  it("needs a line", async () => {
    await expect(
      createDraftClaims(tx, actor, [{ ...draft, lines: [] }], { reason: "charge_import" }),
    ).rejects.toThrow(/at least one line/);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2])(
    "refuses a charge of %s cents",
    async (cents) => {
      await expect(
        createDraftClaims(
          tx,
          actor,
          [{ ...draft, lines: [{ procedureCode: "99213", modifiers: [], units: 1, chargeCents: cents }] }],
          { reason: "charge_import" },
        ),
      ).rejects.toThrow(/whole-cent/);
    },
  );
});
