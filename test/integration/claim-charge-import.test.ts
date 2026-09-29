import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import {
  auditEvents,
  claimLines,
  claims,
  claimVersions,
  locations,
  patients,
  payers,
  providers,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  CHARGE_FILE_HEADER,
  parseChargeFile,
  type ChargeClaim,
  type ChargeProblemCode,
} from "@/domain/claims/charge-file";
import { importChargeClaims, type ChargeImportResult } from "@/domain/claims/charge-import";
import { getClaim } from "@/domain/claims/queries";
import { correctClaim } from "@/domain/claims/versions";
import { createTestTenant } from "./helpers";

// docs/specs/claims.md C2 (charge capture via CSV import). No new table: these tests cover the import
// against the existing claims tables, their row-level security, and the C1 version triggers.
// R-3.10.1 (codes as given), R-3.10.3 (version 1), R-7.2.4 (tenant isolation), R-7.5.1 (audit).

const TODAY = "2026-09-29";
type Ctx = { tenantId: string; userId: string };

interface Practice extends Ctx {
  providerId: string;
  locationId: string;
  otherProviderId: string;
  otherProviderNpi: string;
  otherLocationName: string;
}
let a: Practice;
let b: Practice;

const FIXTURE = readFileSync(
  new URL("../fixtures/synthetic/charge-import-sample.csv", import.meta.url),
  "utf8",
);

async function practice(label: string, extras: { onlyHere?: boolean } = {}): Promise<Practice> {
  const ctx = await createTestTenant(label);
  const db = systemDb();
  const [provider] = await db
    .insert(providers)
    .values({ tenantId: ctx.tenantId, name: "Dr. Synthetic One", npi: "1111111111", taxonomy: "207Q00000X" })
    .returning({ id: providers.id });
  const [other] = await db
    .insert(providers)
    .values({ tenantId: ctx.tenantId, name: "Dr. Synthetic Two", npi: "2222222222", taxonomy: "207R00000X" })
    .returning({ id: providers.id });
  const [location] = await db
    .insert(locations)
    .values({ tenantId: ctx.tenantId, name: "Bayshore Clinic (synthetic)", city: "Tampa" })
    .returning({ id: locations.id });
  await db
    .insert(locations)
    .values({ tenantId: ctx.tenantId, name: "Lake Clinic (synthetic)", city: "Orlando" });
  await db.insert(payers).values([
    {
      tenantId: ctx.tenantId,
      name: "Gulf Coast Mutual (synthetic)",
      ediPayerId: "SYNTH01",
      regime: "fl_insurer",
    },
    {
      tenantId: ctx.tenantId,
      name: "Medicare Part B (synthetic)",
      ediPayerId: "SYNTH02",
      regime: "medicare",
    },
    { tenantId: ctx.tenantId, name: "Sunward HMO (synthetic)", ediPayerId: "SYNTH03", regime: "fl_hmo" },
    { tenantId: ctx.tenantId, name: "Unverified Health (synthetic)" },
  ]);
  if (extras.onlyHere) {
    await db.insert(payers).values({
      tenantId: ctx.tenantId,
      name: "Only In Practice B (synthetic)",
      ediPayerId: "SYNTH09",
      regime: "fl_insurer",
    });
  }
  await db.insert(patients).values(
    ["SYN-901001", "SYN-901002", "SYN-901003", "SYN-901004", "SYN-901005"].map((mrn, i) => ({
      tenantId: ctx.tenantId,
      mrn,
      firstName: `Synthia${i}`,
      lastName: "Testpatient",
      birthDate: "1980-01-01",
      memberIdEnc: "not-a-real-ciphertext",
      memberIdLast4: "0000",
    })),
  );
  return {
    ...ctx,
    providerId: provider!.id,
    locationId: location!.id,
    otherProviderId: other!.id,
    otherProviderNpi: "2222222222",
    otherLocationName: "Lake Clinic (synthetic)",
  };
}

beforeAll(async () => {
  a = await practice("Charge import A");
  b = await practice("Charge import B", { onlyHere: true });
});

afterAll(() => closeDatabase());

function csv(...rows: Record<string, string>[]): string {
  const base: Record<string, string> = {
    "Claim number": "SYN-X-1",
    MRN: "SYN-901004",
    Payer: "Gulf Coast Mutual (synthetic)",
    "Service date": "2026-09-14",
    "Diagnosis codes": "E11.9",
    "Procedure code": "99213",
    Modifiers: "",
    Units: "1",
    Charge: "145.00",
    "Provider NPI": "",
    Location: "",
  };
  return [
    CHARGE_FILE_HEADER.join(","),
    ...rows.map((row) => CHARGE_FILE_HEADER.map((h) => ({ ...base, ...row })[h] ?? "").join(",")),
  ].join("\n");
}

function parse(text: string): { rowCount: number; claims: ChargeClaim[] } {
  const result = parseChargeFile(text, { syntheticOnly: true, today: TODAY });
  if (!result.ok) throw new Error(`fixture did not parse: ${JSON.stringify(result.problems)}`);
  return result;
}

function run(
  ctx: Practice,
  text: string,
  options: {
    today?: string;
    role?: "admin" | "manager" | "specialist" | "compliance";
    defaults?: { providerId: string; locationId: string };
  } = {},
): Promise<ChargeImportResult> {
  const parsed = parse(text);
  return withTenant(ctx, (tx) =>
    importChargeClaims(
      tx,
      { tenantId: ctx.tenantId, userId: ctx.userId, role: options.role ?? "specialist" },
      parsed,
      options.defaults ?? { providerId: ctx.providerId, locationId: ctx.locationId },
      options.today ?? TODAY,
    ),
  );
}

async function claimCount(ctx: Ctx): Promise<number> {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(claims);
    return row!.n;
  });
}

const problemCodes = (result: ChargeImportResult): ChargeProblemCode[] =>
  result.ok ? [] : result.problems.map((p) => p.code);

describe("importing the synthetic sample file", () => {
  let result: ChargeImportResult;
  let before: Awaited<ReturnType<typeof patientRows>>;

  async function patientRows(ctx: Ctx) {
    return withTenant(ctx, (tx) => tx.select().from(patients).orderBy(asc(patients.mrn)));
  }

  beforeAll(async () => {
    before = await patientRows(a);
    result = await run(a, FIXTURE);
  });

  it("creates one draft claim per claim number, with the exact sum of its lines", async () => {
    expect(result).toMatchObject({
      ok: true,
      claims: 3,
      lines: 4,
      billedCents: 21000 + 1800 + 26000 + 114550,
    });
    const rows = await withTenant(a, (tx) =>
      tx
        .select()
        .from(claims)
        .where(inArray(claims.claimNumber, ["SYN-CHG-0001", "SYN-CHG-0002", "SYN-CHG-0003"]))
        .orderBy(asc(claims.claimNumber)),
    );
    expect(
      rows.map((r) => [r.claimNumber, r.status, r.version, r.billedCents, r.paidCents, r.serviceDate]),
    ).toEqual([
      ["SYN-CHG-0001", "draft", 1, 22800, 0, "2026-09-14"],
      ["SYN-CHG-0002", "draft", 1, 26000, 0, "2026-09-10"],
      ["SYN-CHG-0003", "draft", 1, 114550, 0, "2026-03-02"],
    ]);
    expect(rows[0]!.providerId).toBe(a.providerId);
    expect(rows[0]!.locationId).toBe(a.locationId);
    expect(rows[0]!.submittedAt).toBeNull();
    expect(rows[0]!.payerReceivedDate).toBeNull();
    expect(rows[0]!.diagnosisCodes).toEqual(["E11.9", "I10"]);
  });

  it("stores line codes, modifiers, and units exactly as given", async () => {
    const lines = await withTenant(a, async (tx) => {
      const [claim] = await tx
        .select({ id: claims.id })
        .from(claims)
        .where(eq(claims.claimNumber, "SYN-CHG-0001"));
      return tx
        .select()
        .from(claimLines)
        .where(eq(claimLines.claimId, claim!.id))
        .orderBy(asc(claimLines.lineNumber));
    });
    expect(lines.map((l) => [l.lineNumber, l.procedureCode, l.modifiers, l.units, l.chargeCents])).toEqual([
      [1, "99214", ["25"], 1, 21000],
      [2, "36415", [], 1, 1800],
    ]);
  });

  it("writes version 1 through the C1 history: importer, fixed reason, full snapshot", async () => {
    const detail = await withTenant(a, async (tx) => {
      const [claim] = await tx
        .select({ id: claims.id })
        .from(claims)
        .where(eq(claims.claimNumber, "SYN-CHG-0001"));
      return getClaim(tx, claim!.id);
    });
    expect(detail!.history).toHaveLength(1);
    const [v1] = detail!.history;
    expect(v1).toMatchObject({ version: 1, reason: "charge_import", changedBy: a.userId, changedFields: [] });
    expect(v1!.snapshot).toEqual({
      serviceDate: "2026-09-14",
      diagnosisCodes: ["E11.9", "I10"],
      billedCents: 22800,
      status: "draft",
      paidCents: 0,
      lines: [
        { lineNumber: 1, procedureCode: "99214", modifiers: ["25"], units: 1, chargeCents: 21000 },
        { lineNumber: 2, procedureCode: "36415", modifiers: [], units: 1, chargeCents: 1800 },
      ],
    });
  });

  it("leaves an imported draft correctable through C1, which writes version 2", async () => {
    const claim = await withTenant(a, async (tx) => {
      const [row] = await tx.select().from(claims).where(eq(claims.claimNumber, "SYN-CHG-0002"));
      const lines = await tx.select().from(claimLines).where(eq(claimLines.claimId, row!.id));
      return { row: row!, lines };
    });
    const outcome = await withTenant(a, (tx) =>
      correctClaim(tx, {
        ...a,
        claimId: claim.row.id,
        expectedVersion: 1,
        today: TODAY,
        correction: {
          serviceDate: claim.row.serviceDate,
          diagnosisCodes: claim.row.diagnosisCodes,
          lines: claim.lines.map((l) => ({ ...l, units: l.units + 1, chargeCents: l.chargeCents + 100 })),
          reason: "Coder review of the charge",
        },
      }),
    );
    expect(outcome.version).toBe(2);
  });

  it("counts the timely-filing warning without blocking (Sunward HMO claim from March)", () => {
    expect(result).toMatchObject({
      ok: true,
      warnings: {
        pastDeadline: 1,
        dueSoon: 0,
        notConfigured: 0,
        payerUnverified: 0,
        noCoverage: 0,
        patientInactive: 0,
      },
    });
  });

  it("audits every claim and the import: IDs and counts only, never a row value", async () => {
    if (!result.ok) throw new Error("import failed");
    const batchId = result.batchId;
    const events = await withTenant(a, (tx) =>
      tx
        .select()
        .from(auditEvents)
        .where(sql`${auditEvents.metadata}->>'batchId' = ${batchId} or ${auditEvents.entityId} = ${batchId}`),
    );
    const created = events.filter((e) => e.action === "claim.created");
    const completed = events.filter((e) => e.action === "claim.import_completed");
    expect(created).toHaveLength(3);
    expect(
      created.every(
        (e) => e.entityType === "claim" && e.actorUserId === a.userId && e.reason === "charge_import",
      ),
    ).toBe(true);
    expect(
      created
        .map((e) => e.metadata)
        .sort((x, y) => Number((x as { lines: number }).lines) - Number((y as { lines: number }).lines)),
    ).toEqual([
      { batchId, lines: 1, version: 1 },
      { batchId, lines: 1, version: 1 },
      { batchId, lines: 2, version: 1 },
    ]);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ entityType: "claim_import", entityId: batchId });
    expect(completed[0]!.metadata).toEqual({
      rows: 4,
      claims: 3,
      lines: 4,
      pastDeadline: 1,
      dueSoon: 0,
      notConfigured: 0,
      payerUnverified: 0,
      noCoverage: 0,
      patientInactive: 0,
    });
    const text = JSON.stringify(events);
    for (const secret of [
      "SYN-901001",
      "SYN-CHG-0001",
      "99214",
      "E11.9",
      "Gulf Coast",
      "21000",
      "Testpatient",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("never creates or changes a patient", async () => {
    const after = await patientRows(a);
    expect(after).toEqual(before);
  });
});

describe("duplicates", () => {
  it("refuses the same file twice, once, and creates nothing", async () => {
    const ctx = await practice("Charge import dup");
    const first = await run(ctx, FIXTURE);
    expect(first.ok).toBe(true);
    const count = await claimCount(ctx);
    const again = await run(ctx, FIXTURE);
    expect(again).toMatchObject({ ok: false, reason: "duplicate", total: 1 });
    expect(problemCodes(again)).toEqual(["already_imported"]);
    expect(await claimCount(ctx)).toBe(count);
  });

  it("refuses a file with one existing claim number and one new claim: all or nothing", async () => {
    const ctx = await practice("Charge import partial");
    await run(ctx, csv({ "Claim number": "SYN-P-1" }));
    const count = await claimCount(ctx);
    const result = await run(
      ctx,
      csv(
        { "Claim number": "SYN-P-1" },
        { "Claim number": "SYN-P-2", MRN: "SYN-901005", "Service date": "2026-09-13" },
      ),
    );
    expect(result).toMatchObject({ ok: false, reason: "duplicate" });
    expect(result.ok ? [] : result.problems).toEqual([
      { row: 2, code: "claim_number_exists", column: "Claim number" },
    ]);
    expect(await claimCount(ctx)).toBe(count);
  });

  it("refuses a different claim number for the same patient, payer, date, and code with the same modifiers", async () => {
    const ctx = await practice("Charge import same-service");
    await run(ctx, csv({ "Claim number": "SYN-S-1", Modifiers: "25" }));
    const dup = await run(ctx, csv({ "Claim number": "SYN-S-2", Modifiers: "25" }));
    expect(problemCodes(dup)).toEqual(["matches_existing_claim"]);
    expect(dup).toMatchObject({ ok: false, reason: "duplicate" });
    // Same service, another status: a paid claim still counts.
    await withTenant(ctx, (tx) =>
      tx.update(claims).set({ status: "paid" }).where(eq(claims.claimNumber, "SYN-S-1")),
    );
    expect(problemCodes(await run(ctx, csv({ "Claim number": "SYN-S-3", Modifiers: "25" })))).toEqual([
      "matches_existing_claim",
    ]);
  });

  it("does not refuse when only the modifiers, the date, the payer, or the patient differ", async () => {
    const ctx = await practice("Charge import near-miss");
    await run(ctx, csv({ "Claim number": "SYN-N-1", Modifiers: "25" }));
    const result = await run(
      ctx,
      csv(
        { "Claim number": "SYN-N-2", Modifiers: "59" },
        { "Claim number": "SYN-N-3", "Service date": "2026-09-15", Modifiers: "25" },
        { "Claim number": "SYN-N-4", Payer: "Sunward HMO (synthetic)", Modifiers: "25" },
        { "Claim number": "SYN-N-5", MRN: "SYN-901005", Modifiers: "25" },
      ),
    );
    expect(result).toMatchObject({ ok: true, claims: 4 });
  });

  it("refuses two claims in the file that match each other", async () => {
    const ctx = await practice("Charge import in-file");
    const result = await run(ctx, csv({ "Claim number": "SYN-F-1" }, { "Claim number": "SYN-F-2" }));
    expect(problemCodes(result)).toEqual(["matches_claim_in_file"]);
    expect(result.ok ? [] : result.problems[0]!.row).toBe(3);
    expect(await claimCount(ctx)).toBe(0);
  });

  it("lets only one of two simultaneous uploads of the same file through", async () => {
    const ctx = await practice("Charge import race");
    const results = await Promise.all([run(ctx, FIXTURE), run(ctx, FIXTURE)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(problemCodes(results.find((r) => !r.ok)!)).toEqual(["already_imported"]);
    expect(await claimCount(ctx)).toBe(3);
  });
});

describe("matching patients, payers, providers, and locations", () => {
  it("refuses an unknown MRN and never creates the patient", async () => {
    const ctx = await practice("Charge import no-patient");
    const patientsBefore = await withTenant(ctx, (tx) => tx.select({ id: patients.id }).from(patients));
    const result = await run(
      ctx,
      csv({ "Claim number": "SYN-M-1", MRN: "SYN-999999" }, { "Claim number": "SYN-M-2" }),
    );
    expect(result).toMatchObject({ ok: false, reason: "validation" });
    expect(result.ok ? [] : result.problems).toEqual([{ row: 2, code: "patient_not_found", column: "MRN" }]);
    // All or nothing: the valid second claim was not created either.
    expect(await claimCount(ctx)).toBe(0);
    const patientsAfter = await withTenant(ctx, (tx) => tx.select({ id: patients.id }).from(patients));
    expect(patientsAfter).toHaveLength(patientsBefore.length);
  });

  it("refuses an unknown payer, a blank match, and never creates the payer", async () => {
    const ctx = await practice("Charge import no-payer");
    const result = await run(ctx, csv({ Payer: "Nobody Health" }));
    expect(result.ok ? [] : result.problems).toEqual([{ row: 2, code: "payer_not_found", column: "Payer" }]);
    const names = await withTenant(ctx, (tx) => tx.select({ name: payers.name }).from(payers));
    expect(names.map((n) => n.name)).not.toContain("Nobody Health");
  });

  it("refuses two payers it can't tell apart", async () => {
    const ctx = await practice("Charge import ambiguous-payer");
    await systemDb().insert(payers).values({
      tenantId: ctx.tenantId,
      name: "Twin Health (synthetic)",
      ediPayerId: "T1",
      regime: "fl_hmo",
    });
    await systemDb().insert(payers).values({
      tenantId: ctx.tenantId,
      name: "Twin Health (synthetic)",
      ediPayerId: "T2",
      regime: "fl_hmo",
    });
    expect(problemCodes(await run(ctx, csv({ Payer: "twin health (synthetic)" })))).toEqual([
      "payer_ambiguous",
    ]);
  });

  it("accepts an unverified payer and reports it as a warning, with no filing deadline computed", async () => {
    const ctx = await practice("Charge import unverified");
    const result = await run(
      ctx,
      csv({ Payer: "Unverified Health (synthetic)", "Service date": "2026-01-05" }),
    );
    expect(result).toMatchObject({
      ok: true,
      warnings: { payerUnverified: 1, pastDeadline: 0, dueSoon: 0, notConfigured: 0 },
    });
  });

  it("uses the row's provider NPI and location name, else the form's defaults", async () => {
    const ctx = await practice("Charge import provider-location");
    const result = await run(
      ctx,
      csv(
        {
          "Claim number": "SYN-L-1",
          "Provider NPI": ctx.otherProviderNpi,
          Location: ctx.otherLocationName.toUpperCase(),
        },
        { "Claim number": "SYN-L-2", MRN: "SYN-901005" },
      ),
    );
    expect(result.ok).toBe(true);
    const rows = await withTenant(ctx, (tx) => tx.select().from(claims).orderBy(asc(claims.claimNumber)));
    expect(rows[0]!.providerId).toBe(ctx.otherProviderId);
    expect(rows[0]!.locationId).not.toBe(ctx.locationId);
    expect(rows[1]!.providerId).toBe(ctx.providerId);
    expect(rows[1]!.locationId).toBe(ctx.locationId);
  });

  it("refuses an unknown provider NPI and an unknown location", async () => {
    const ctx = await practice("Charge import bad-provider");
    const result = await run(ctx, csv({ "Provider NPI": "9999999999", Location: "Nowhere Clinic" }));
    expect(problemCodes(result).sort()).toEqual(["location_not_found", "provider_not_found"]);
  });
});

describe("tenant isolation (R-7.2.4)", () => {
  it("does not see another practice's patients, payers, or claim numbers", async () => {
    // Practice A already imported the fixture above (or will in its own describe); make it certain.
    const ctx = await practice("Charge import isolation A");
    const other = await practice("Charge import isolation B", { onlyHere: true });
    await run(ctx, csv({ "Claim number": "SYN-ISO-1" }));
    // A payer that exists only in the other practice is not found here.
    expect(
      problemCodes(
        await run(ctx, csv({ "Claim number": "SYN-ISO-2", Payer: "Only In Practice B (synthetic)" })),
      ),
    ).toEqual(["payer_not_found"]);
    // The same claim number is free in the other practice, and the same MRN is its own patient.
    const created = await run(other, csv({ "Claim number": "SYN-ISO-1" }));
    expect(created).toMatchObject({ ok: true, claims: 1 });
    const mine = await withTenant(ctx, (tx) =>
      tx.select({ tenantId: claims.tenantId, patientId: claims.patientId }).from(claims),
    );
    const theirs = await withTenant(other, (tx) =>
      tx.select({ tenantId: claims.tenantId, patientId: claims.patientId }).from(claims),
    );
    expect(mine.every((r) => r.tenantId === ctx.tenantId)).toBe(true);
    expect(theirs.every((r) => r.tenantId === other.tenantId)).toBe(true);
    expect(theirs).toHaveLength(1);
    expect(new Set([...mine, ...theirs].map((r) => r.patientId)).size).toBe(2);
  });

  it("refuses default provider and location IDs that belong to another practice", async () => {
    const ctx = await practice("Charge import foreign-defaults");
    const result = await run(ctx, csv({}), {
      defaults: { providerId: b.providerId, locationId: b.locationId },
    });
    expect(result).toMatchObject({ ok: false, reason: "defaults" });
    expect(await claimCount(ctx)).toBe(0);
  });

  it("writes nothing visible to another practice: a's claims stay out of b's reads", async () => {
    const aClaims = await claimCount(a);
    const bClaims = await claimCount(b);
    const bView = await withTenant(b, (tx) =>
      tx.select({ n: sql<number>`count(*)::int` }).from(claimVersions),
    );
    expect(aClaims).toBeGreaterThan(0);
    expect(bClaims).toBe(0);
    expect(bView[0]!.n).toBe(0);
  });
});

describe("roles", () => {
  it("refuses compliance in the domain, whatever the caller did, and writes nothing", async () => {
    const ctx = await practice("Charge import compliance");
    const result = await run(ctx, csv({}), { role: "compliance" });
    expect(result).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await claimCount(ctx)).toBe(0);
  });

  it.each(["admin", "manager", "specialist"] as const)("lets %s import", async (role) => {
    const ctx = await practice(`Charge import ${role}`);
    expect(await run(ctx, csv({}), { role })).toMatchObject({ ok: true, claims: 1 });
  });
});

describe("timely filing warns and never blocks (R-3.1.5)", () => {
  // Florida: 6 months from 2026-03-31 is 2026-09-30.
  it.each([
    ["2026-09-29", { dueSoon: 1, pastDeadline: 0 }],
    ["2026-09-30", { dueSoon: 1, pastDeadline: 0 }],
    ["2026-10-01", { dueSoon: 0, pastDeadline: 1 }],
  ])("Florida claim with today %s still imports", async (today, expected) => {
    const ctx = await practice(`Charge import filing ${today}`);
    const result = await run(ctx, csv({ "Service date": "2026-03-31" }), { today });
    expect(result).toMatchObject({ ok: true, claims: 1, warnings: expected });
  });
});

describe("what the import can never do", () => {
  it("has no path that writes a patient", () => {
    for (const path of [
      "../../src/domain/claims/charge-import.ts",
      "../../src/domain/claims/charge-file.ts",
    ]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source, path).not.toMatch(/\.(insert|update|delete)\(\s*patients\s*\)/);
      expect(source, path).not.toMatch(/domain\/patients\//);
    }
  });

  it("creates no table row outside claims, lines, versions, and audit", async () => {
    const ctx = await practice("Charge import footprint");
    const count = async () =>
      withTenant(ctx, async (tx) => {
        const tables = [patients, payers, providers, locations];
        return Promise.all(
          tables.map(async (t) => (await tx.select({ n: sql<number>`count(*)::int` }).from(t))[0]!.n),
        );
      });
    const before = await count();
    await run(ctx, csv({}));
    expect(await count()).toEqual(before);
  });
});
