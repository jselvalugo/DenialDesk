import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, claims, locations, patients, payers, practiceSettings, providers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  CONTROL_NUMBER_KEY,
  generateClaim837P,
  nextControlNumber,
  type Generate837Result,
} from "@/domain/claims/edi-837p";
import { createDraftClaims } from "@/domain/claims/versions";
import { tokenize } from "@/edi/x12/segments";
import { decryptField, encryptField } from "@/lib/crypto/field";
import { decryptProviderTin, encryptProviderTin } from "@/lib/crypto/provider-tin";
import {
  createTestTenant,
  expectDbError,
  insertSyncedPatient,
  makeActiveConnection,
  makeRunningRun,
} from "./helpers";

// docs/specs/claims.md C3a (837P generation). No new table and no GRANT: the control number lives in the
// existing `practice_settings` table (RLS, app role already SELECT/INSERT/UPDATE). These tests cover the
// service against the real tables: coverage guards, refusals, control numbers, audit, and tenant isolation.
// R-3.10.1 (codes copied), R-7.2.4 (tenant isolation), R-7.3.3 (encrypted fields), R-7.5.1 (audit).

type Ctx = { tenantId: string; userId: string };
type Role = "admin" | "manager" | "specialist" | "compliance";

const MEMBER_ID = "SYN123456789";
const TIN = "000000001";

interface Billing {
  providerId: string;
  locationId: string;
  payerId: string;
  patientId: string;
}

let a: Ctx & Billing;
let b: Ctx & Billing;
let seq = 0;

/** A practice with a complete billing provider, a location with a place of service, a payer, and a patient. */
async function seedBilling(ctx: Ctx): Promise<Billing> {
  const db = systemDb();
  const [provider] = await db
    .insert(providers)
    .values({
      tenantId: ctx.tenantId,
      name: "Dr. Avery Synthprovider (synthetic)",
      npi: "1234567893",
      taxonomy: "207R00000X",
      firstName: "Avery",
      lastName: "Synthprovider",
      addressLine1: "100 Synthetic Way",
      city: "Tampa",
      state: "FL",
      postalCode: "336020001",
      tinType: "EI",
    })
    .returning({ id: providers.id });
  await db
    .update(providers)
    .set({ tinEnc: encryptProviderTin(TIN, ctx.tenantId, provider!.id) })
    .where(eq(providers.id, provider!.id));
  const [location] = await db
    .insert(locations)
    .values({
      tenantId: ctx.tenantId,
      name: "Bayshore Clinic (synthetic)",
      city: "Tampa",
      placeOfService: "11",
    })
    .returning({ id: locations.id });
  const [payer] = await db
    .insert(payers)
    .values({
      tenantId: ctx.tenantId,
      name: "Gulf Coast Mutual (synthetic)",
      ediPayerId: "SYNTH01",
      regime: "fl_insurer",
    })
    .returning({ id: payers.id });
  const patient = await manualPatient(ctx, payer!.id, MEMBER_ID);
  return { providerId: provider!.id, locationId: location!.id, payerId: payer!.id, patientId: patient };
}

async function manualPatient(ctx: Ctx, payerId: string | null, memberId: string): Promise<string> {
  seq += 1;
  const [patient] = await systemDb()
    .insert(patients)
    .values({
      tenantId: ctx.tenantId,
      mrn: `SYN-83700${seq}`,
      firstName: "Jane",
      lastName: "Synthpatient",
      birthDate: "1980-01-15",
      sex: "F",
      addressLine1: "200 Synthetic Way",
      city: "Tampa",
      state: "FL",
      postalCode: "33602",
      primaryPayerId: payerId,
      memberIdEnc: encryptField(memberId),
      memberIdLast4: memberId.slice(-4),
    })
    .returning({ id: patients.id });
  return patient!.id;
}

async function newClaim(
  ctx: Ctx,
  base: Billing,
  overrides: Partial<{
    patientId: string;
    providerId: string;
    locationId: string;
    payerId: string;
    diagnosisCodes: string[];
    lines: { procedureCode: string; modifiers: string[]; units: number; chargeCents: number }[];
  }> = {},
): Promise<string> {
  seq += 1;
  const [created] = await withTenant(ctx, (tx) =>
    createDraftClaims(
      tx,
      ctx,
      [
        {
          claimNumber: `SYN-837-${seq}-${Date.now()}`,
          patientId: overrides.patientId ?? base.patientId,
          providerId: overrides.providerId ?? base.providerId,
          locationId: overrides.locationId ?? base.locationId,
          payerId: overrides.payerId ?? base.payerId,
          serviceDate: "2026-09-01",
          diagnosisCodes: overrides.diagnosisCodes ?? ["E11.9"],
          lines: overrides.lines ?? [
            { procedureCode: "99213", modifiers: ["25"], units: 1, chargeCents: 12_500 },
            { procedureCode: "36415", modifiers: [], units: 1, chargeCents: 3_000 },
          ],
        },
      ],
      { reason: "charge_import" },
    ),
  );
  return created!.id;
}

function generate(
  ctx: Ctx,
  claimId: string,
  options: { role?: Role; pointers?: Record<number, number[]>; today?: string } = {},
): Promise<Generate837Result> {
  return withTenant(ctx, (tx) =>
    generateClaim837P(tx, { ...ctx, role: options.role ?? "specialist" }, claimId, {
      pointers: options.pointers,
      now: new Date("2026-09-29T14:30:00Z"),
      today: options.today ?? "2026-09-29",
    }),
  );
}

async function events(ctx: Ctx, claimId: string, action: "claim.837p_generated" | "claim.837p_refused") {
  return withTenant(ctx, (tx) =>
    tx
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, action), eq(auditEvents.entityId, claimId))),
  );
}

async function counter(ctx: Ctx): Promise<number | null> {
  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({ value: practiceSettings.value })
      .from(practiceSettings)
      .where(eq(practiceSettings.key, CONTROL_NUMBER_KEY)),
  );
  return rows.length === 0 ? null : Number(rows[0]!.value);
}

function ok(result: Generate837Result) {
  if (!result.ok) throw new Error(`expected a generated file, got ${JSON.stringify(result)}`);
  return result;
}

function refusal(result: Generate837Result) {
  if (result.ok) throw new Error("expected a refusal");
  return result;
}

const codes = (result: Generate837Result): string[] => refusal(result).issues.map((i) => i.code);

beforeAll(async () => {
  const ctxA = await createTestTenant("837P A");
  const ctxB = await createTestTenant("837P B");
  a = { ...ctxA, ...(await seedBilling(ctxA)) };
  b = { ...ctxB, ...(await seedBilling(ctxB)) };
});

afterAll(() => closeDatabase());

describe("generating an 837P (docs/specs/claims.md C3a)", () => {
  it("builds a test-indicator file, leaves the claim unchanged, and audits IDs and counts only", async () => {
    const claimId = await newClaim(a, a);
    const before = await systemDb().select().from(claims).where(eq(claims.id, claimId));
    const result = ok(await generate(a, claimId));

    const { segments } = tokenize(result.text);
    expect(segments[0]!.id).toBe("ISA");
    expect(segments[0]!.elements[14]).toBe("T");
    expect(result.text).toContain(`MI*${MEMBER_ID}~`);
    expect(result.text).toContain(`REF*EI*${TIN}~`);
    expect(result.text).toContain("HI*ABK:E119~");
    expect(result.text).toContain("SV1*HC:99213:25*125.00*UN*1***1~");
    expect(result.preview).not.toContain(MEMBER_ID);
    expect(result.preview).not.toContain(TIN);
    expect(result.filename).toBe(`837p-${String(result.controlNumber).padStart(9, "0")}.x12`);
    expect(result.segmentCount).toBe(segments.length);
    expect(result.lineCount).toBe(2);

    // Nothing on the claim changed: no status, version, or code write.
    const after = await systemDb().select().from(claims).where(eq(claims.id, claimId));
    expect(after).toEqual(before);
    expect(after[0]!.diagnosisCodes).toEqual(["E11.9"]);

    const [event] = await events(a, claimId, "claim.837p_generated");
    expect(event).toMatchObject({
      actorUserId: a.userId,
      entityType: "claim",
      reason: "edi_generation",
      metadata: {
        patientId: a.patientId,
        claimVersion: 1,
        controlNumber: result.controlNumber,
        segmentCount: result.segmentCount,
        lineCount: 2,
        usage: "T",
        pointerSource: "single_diagnosis",
        phiRead: "member_id,tin",
      },
    });
    // No segment content, code, name, member ID, TIN, or amount in the audit row.
    const text = JSON.stringify(event);
    for (const secret of [MEMBER_ID, TIN, "Synthpatient", "Jane", "E11", "125.00", "Synthetic Way"])
      expect(text).not.toContain(secret);
  });

  it("uses one number for ISA13, GS06, ST02, and BHT03, never repeats, and counts per practice", async () => {
    const first = ok(await generate(a, await newClaim(a, a)));
    const second = ok(await generate(a, await newClaim(a, a)));
    expect(second.controlNumber).toBe(first.controlNumber + 1);
    const { segments } = tokenize(second.text);
    const n = second.controlNumber;
    expect(Number(segments.find((s) => s.id === "ISA")!.elements[12])).toBe(n);
    expect(Number(segments.find((s) => s.id === "GS")!.elements[5])).toBe(n);
    expect(Number(segments.find((s) => s.id === "ST")!.elements[1])).toBe(n);
    expect(Number(segments.find((s) => s.id === "BHT")!.elements[2])).toBe(n);
    expect(Number(segments.find((s) => s.id === "IEA")!.elements[1])).toBe(n);

    // Practice B has its own sequence, untouched by A's.
    const bBefore = await counter(b);
    const firstB = ok(await generate(b, await newClaim(b, b)));
    expect(firstB.controlNumber).toBe((bBefore ?? 0) + 1);
    expect(await counter(a)).toBe(second.controlNumber);
  });

  it("gives concurrent generations distinct numbers", async () => {
    const ids = await Promise.all(Array.from({ length: 6 }, () => newClaim(a, a)));
    const start = (await counter(a))!;
    const results = await Promise.all(ids.map((id) => generate(a, id)));
    const numbers = results.map((r) => ok(r).controlNumber).sort((x, y) => x - y);
    expect(numbers).toEqual(Array.from({ length: 6 }, (_, i) => start + 1 + i));
  });

  it("copies codes exactly: the decimal is the only change, and the claim keeps its own", async () => {
    const claimId = await newClaim(a, a, {
      diagnosisCodes: ["E11.9", "I10", "S72.001A"],
      lines: [
        { procedureCode: "99213", modifiers: ["25", "59"], units: 2, chargeCents: 20_000 },
        { procedureCode: "J1100", modifiers: [], units: 1, chargeCents: 1_500 },
      ],
    });
    const result = ok(await generate(a, claimId, { pointers: { 1: [1, 2], 2: [3] } }));
    const segments = tokenize(result.text).segments;
    expect(segments.find((s) => s.id === "HI")!.elements).toEqual(["ABK:E119", "ABF:I10", "ABF:S72001A"]);
    const sv1 = segments.filter((s) => s.id === "SV1").map((s) => s.elements);
    expect(sv1).toEqual([
      ["HC:99213:25:59", "200.00", "UN", "2", "", "", "1:2"],
      ["HC:J1100", "15.00", "UN", "1", "", "", "3"],
    ]);
    const [row] = await systemDb().select().from(claims).where(eq(claims.id, claimId));
    expect(row!.diagnosisCodes).toEqual(["E11.9", "I10", "S72.001A"]);
    const [event] = await events(a, claimId, "claim.837p_generated");
    expect(event!.metadata).toMatchObject({ pointerSource: "user_selected" });
  });

  it("asks for a pointer choice when there are several diagnoses, and never guesses one", async () => {
    const claimId = await newClaim(a, a, { diagnosisCodes: ["E11.9", "I10"] });
    const before = await counter(a);
    const result = await generate(a, claimId);
    expect(refusal(result).issues).toEqual([
      { code: "diagnosis_pointers_required", line: 1 },
      { code: "diagnosis_pointers_required", line: 2 },
    ]);
    expect(await counter(a)).toBe(before);
    const badPointer = await generate(a, claimId, { pointers: { 1: [1], 2: [3] } });
    expect(refusal(badPointer).issues).toEqual([{ code: "diagnosis_pointer_invalid", line: 2 }]);
  });

  it("sends a rejected claim again as an original, and refuses any other status", async () => {
    const rejected = await newClaim(a, a);
    await systemDb().update(claims).set({ status: "rejected" }).where(eq(claims.id, rejected));
    ok(await generate(a, rejected));
    for (const status of [
      "submitted",
      "acknowledged",
      "paid",
      "partially_paid",
      "denied",
      "closed",
    ] as const) {
      const claimId = await newClaim(a, a);
      await systemDb().update(claims).set({ status }).where(eq(claims.id, claimId));
      const before = await counter(a);
      expect(codes(await generate(a, claimId)), status).toEqual(["status_not_generatable"]);
      expect(await counter(a)).toBe(before);
    }
  });
});

describe("what is refused, and that nothing is spent or leaked (R-7.4.6)", () => {
  it("lists every missing billing detail together, decrypts nothing it doesn't need, and takes no number", async () => {
    const db = systemDb();
    const [bareProvider] = await db
      .insert(providers)
      .values({
        tenantId: a.tenantId,
        name: "Dr. Bare (synthetic)",
        npi: "1111111111",
        taxonomy: "not-a-code",
      })
      .returning({ id: providers.id });
    const [bareLocation] = await db
      .insert(locations)
      .values({ tenantId: a.tenantId, name: "Bare Clinic (synthetic)", city: "Tampa" })
      .returning({ id: locations.id });
    const claimId = await newClaim(a, a, { providerId: bareProvider!.id, locationId: bareLocation!.id });
    const before = await counter(a);

    const result = await generate(a, claimId);
    expect(new Set(codes(result))).toEqual(
      new Set([
        "billing_npi",
        "billing_name",
        "billing_taxonomy",
        "billing_tin",
        "billing_address",
        "missing_place_of_service",
      ]),
    );
    expect(await counter(a)).toBe(before);
    const [event] = await events(a, claimId, "claim.837p_refused");
    expect(event).toMatchObject({
      reason: "edi_generation",
      metadata: { refusal: "invalid", issueCount: 6, phiRead: "member_id" },
    });
    expect(JSON.stringify(event)).not.toContain(MEMBER_ID);
    expect(await events(a, claimId, "claim.837p_generated")).toHaveLength(0);
  });

  it("refuses a patient with no member ID, and writes nothing blank for NM109", async () => {
    const empty = await manualPatient(a, a.payerId, "");
    const claimId = await newClaim(a, a, { patientId: empty });
    expect(codes(await generate(a, claimId))).toEqual(["no_member_id"]);
  });

  it("refuses a claim whose payer is not the patient's primary payer, without reading the member ID", async () => {
    const [other] = await systemDb()
      .insert(payers)
      .values({
        tenantId: a.tenantId,
        name: "Second Payer (synthetic)",
        ediPayerId: "SYNTH02",
        regime: "fl_hmo",
      })
      .returning({ id: payers.id });
    const claimId = await newClaim(a, a, { payerId: other!.id });
    expect(codes(await generate(a, claimId))).toEqual(["coverage_payer_mismatch"]);
    const [event] = await events(a, claimId, "claim.837p_refused");
    expect(event!.metadata).toMatchObject({ phiRead: "tin" });
    // A patient with no primary payer at all is the same refusal.
    const noPayer = await manualPatient(a, null, "SYN-NOPAYER-1");
    const second = await newClaim(a, a, { patientId: noPayer });
    expect(codes(await generate(a, second))).toEqual(["coverage_payer_mismatch"]);
  });

  it("refuses an unverified payer, and a regime whose claim filing indicator isn't confirmed", async () => {
    const [noEdi] = await systemDb()
      .insert(payers)
      .values({ tenantId: a.tenantId, name: "Unverified Health (synthetic)" })
      .returning({ id: payers.id });
    const [advantage] = await systemDb()
      .insert(payers)
      .values({
        tenantId: a.tenantId,
        name: "Keystone Advantage (synthetic)",
        ediPayerId: "SYNTH04",
        regime: "medicare_advantage",
      })
      .returning({ id: payers.id });
    for (const [payerId, expected] of [
      [noEdi!.id, "payer_not_verified"],
      [advantage!.id, "claim_filing_indicator_unmapped"],
    ] as const) {
      const patientId = await manualPatient(a, payerId, MEMBER_ID);
      const claimId = await newClaim(a, a, { patientId, payerId });
      expect(codes(await generate(a, claimId))).toEqual([expected]);
    }
  });

  it("refuses compliance and audits the attempt, without taking a number", async () => {
    const claimId = await newClaim(a, a);
    const before = await counter(a);
    const result = await generate(a, claimId, { role: "compliance" });
    expect(result).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await counter(a)).toBe(before);
    const [event] = await events(a, claimId, "claim.837p_refused");
    expect(event).toMatchObject({ actorUserId: a.userId, metadata: { refusal: "forbidden", issueCount: 0 } });
  });

  it("refuses in production, where only synthetic identifiers exist, and takes no number", async () => {
    const keys = ["APP_ENV", "NETLIFY", "NETLIFY_DB_URL", "DEPLOY_ID", "SITE_ID"];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    const claimId = await newClaim(a, a);
    const before = await counter(a);
    try {
      process.env.APP_ENV = "production";
      for (const name of ["NETLIFY", "NETLIFY_DB_URL", "DEPLOY_ID", "SITE_ID"]) delete process.env[name];
      const result = await generate(a, claimId);
      expect(refusal(result).issues).toEqual([{ code: "not_synthetic_environment" }]);
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
    expect(await counter(a)).toBe(before);
    const [event] = await events(a, claimId, "claim.837p_refused");
    expect(event!.metadata).toMatchObject({ issueCodes: "not_synthetic_environment" });
  });

  it("refuses at 999,999,999 and never wraps", async () => {
    const ctx = await createTestTenant("837P exhausted");
    const base = await seedBilling(ctx);
    await systemDb()
      .insert(practiceSettings)
      .values({ tenantId: ctx.tenantId, key: CONTROL_NUMBER_KEY, value: "999999998" });
    const last = ok(await generate(ctx, await newClaim(ctx, base)));
    expect(last.controlNumber).toBe(999_999_999);
    expect(last.text).toContain("*999999999*");
    const claimId = await newClaim(ctx, base);
    expect(codes(await generate(ctx, claimId))).toEqual(["control_number_exhausted"]);
  });
});

describe("a patient synced from an EHR (patient-integrations PI1a, claims C1 note)", () => {
  async function syncedPractice() {
    const { ctx, connId } = await makeActiveConnection("837P synced");
    const base = await seedBilling(ctx);
    const runId = await makeRunningRun(ctx, connId);
    const synced = (overrides: Record<string, unknown>) =>
      insertSyncedPatient(ctx, connId, runId, {
        firstName: "Fhira",
        lastName: "Synthpatient",
        addressLine1: "300 Synthetic Way",
        city: "Tampa",
        state: "FL",
        postalCode: "33602",
        ...overrides,
      });
    return { ctx, base, synced };
  }

  it("is refused while its coverage is none or unmapped, and its member ID is not even read", async () => {
    const { ctx, base, synced } = await syncedPractice();
    const none = await synced({});
    const unmapped = await synced({
      coverageStatus: "unmapped",
      coveragePayorKey: "Organization/syn-org-1",
      memberIdEnc: encryptField("SYN-UNMAPPED-77"),
      memberIdLast4: "D-77",
    });
    for (const patientId of [none, unmapped]) {
      const claimId = await newClaim(ctx, base, { patientId });
      expect(codes(await generate(ctx, claimId))).toContain("no_member_id");
      const [event] = await events(ctx, claimId, "claim.837p_refused");
      expect(event!.metadata).toMatchObject({ phiRead: "tin" });
    }
  });

  it("generates once the coverage is mapped to the claim's payer", async () => {
    const { ctx, base, synced } = await syncedPractice();
    const mapped = await synced({
      coverageStatus: "mapped",
      coveragePayorKey: "Organization/syn-org-1",
      primaryPayerId: base.payerId,
      memberIdEnc: encryptField("SYN-MAPPED-4321"),
      memberIdLast4: "4321",
    });
    const result = ok(await generate(ctx, await newClaim(ctx, base, { patientId: mapped })));
    expect(result.text).toContain("MI*SYN-MAPPED-4321~");
  });
});

describe("tenant isolation (R-7.2.4)", () => {
  it("does not see another practice's claim, and leaves its control number alone", async () => {
    const claimOfB = await newClaim(b, b);
    const before = await counter(b);
    const result = await generate(a, claimOfB);
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    expect(await counter(b)).toBe(before);
    // The attempt is audited in A's log, never B's.
    expect(await events(a, claimOfB, "claim.837p_refused")).toHaveLength(1);
    expect(await events(b, claimOfB, "claim.837p_refused")).toHaveLength(0);
  });

  it("keeps each practice's control number row invisible and immutable to the other (RLS on practice_settings)", async () => {
    ok(await generate(a, await newClaim(a, a)));
    ok(await generate(b, await newClaim(b, b)));
    const seenByB = await withTenant(b, (tx) =>
      tx.select().from(practiceSettings).where(eq(practiceSettings.key, CONTROL_NUMBER_KEY)),
    );
    expect(seenByB.map((r) => r.tenantId)).toEqual([b.tenantId]);
    const before = await counter(a);
    const touched = await withTenant(b, (tx) =>
      tx
        .update(practiceSettings)
        .set({ value: "1" })
        .where(and(eq(practiceSettings.tenantId, a.tenantId), eq(practiceSettings.key, CONTROL_NUMBER_KEY)))
        .returning({ id: practiceSettings.id }),
    );
    expect(touched).toEqual([]);
    expect(await counter(a)).toBe(before);
    // B cannot write a counter row for A either.
    await expectDbError(
      withTenant(b, (tx) =>
        tx.insert(practiceSettings).values({ tenantId: a.tenantId, key: "x12.other", value: "1" }),
      ),
      /row-level security/,
    );
  });

  it("increments atomically through nextControlNumber", async () => {
    const ctx = await createTestTenant("837P counter");
    const numbers = await Promise.all(
      Array.from({ length: 8 }, () => withTenant(ctx, (tx) => nextControlNumber(tx, ctx.tenantId))),
    );
    expect(numbers.sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("provider billing fields (migration 0046)", () => {
  it("stores the TIN encrypted, bound to its practice and provider", async () => {
    const [row] = await systemDb().select().from(providers).where(eq(providers.id, a.providerId));
    expect(row!.tinEnc!.startsWith("v1.")).toBe(true);
    expect(row!.tinEnc).not.toContain(TIN);
    expect(decryptProviderTin(row!.tinEnc!, a.tenantId, a.providerId)).toBe(TIN);
    expect(() => decryptProviderTin(row!.tinEnc!, b.tenantId, a.providerId)).toThrow();
    expect(() => decryptProviderTin(row!.tinEnc!, a.tenantId, b.providerId)).toThrow();
    // The plain field key is not enough either: the AAD is part of the ciphertext's authentication.
    expect(() => decryptField(row!.tinEnc!)).toThrow();
  });

  it("checks shapes in the database: state, ZIP, TIN type with TIN, and place of service", async () => {
    const write = (values: Record<string, unknown>) =>
      withTenant(a, (tx) => tx.update(providers).set(values).where(eq(providers.id, a.providerId)));
    await expectDbError(write({ state: "fl" }), /providers_state_shape/);
    await expectDbError(write({ postalCode: "3360" }), /providers_postal_code_shape/);
    await expectDbError(write({ tinType: "XX", tinEnc: "v1.x.y.z" }), /providers_tin_type_valid/);
    await expectDbError(write({ tinType: null }), /providers_tin_together/);
    await expectDbError(
      withTenant(a, (tx) =>
        tx.update(locations).set({ placeOfService: "1" }).where(eq(locations.id, a.locationId)),
      ),
      /locations_place_of_service_shape/,
    );
    // A valid change still works (the app role holds the table-level UPDATE from drizzle/0002).
    await write({ state: "FL" });
  });
});
