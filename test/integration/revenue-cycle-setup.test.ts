import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { closeDatabase } from "@/db/client";
import { businessRules, glAccounts, locations, payerClasses, payers, rcmSites } from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { withTenant } from "@/db/tenant";
import { DEFAULT_RULES } from "@/domain/revenue-cycle/defaults";
import { prepareEngine } from "@/domain/revenue-cycle/engine";
import { ledgerSetup, loadEngineConfig, seedRevenueCycleDefaults } from "@/domain/revenue-cycle/setup";
import { generateDataset } from "@/domain/synthetic/generator";
import { createTestTenant, expectDbError } from "./helpers";

type Ctx = { tenantId: string; userId: string };
let seeded: Ctx;
let empty: Ctx;

beforeAll(async () => {
  const suffix = `${Date.now()}`;
  const { tenantId, userIds } = await seedPractice({
    practiceName: `RCM setup ${suffix} (synthetic)`,
    asOf: todayIn(),
    users: [{ email: `rcm-${suffix}@synthetic.test`, displayName: "RCM Admin", role: "admin" }],
    dataset: generateDataset({ asOf: todayIn(), seed: 7, patients: 3, claims: 6 }),
  });
  seeded = { tenantId, userId: userIds[0]! };
  empty = await createTestTenant("RCM empty");
});

afterAll(() => closeDatabase());

describe("revenue cycle defaults", () => {
  it("are seeded with every new synthetic practice", async () => {
    const setup = await withTenant(seeded, (tx) => ledgerSetup(tx));
    expect(setup.rules.map((r) => r.code)).toEqual(DEFAULT_RULES.map((r) => r.code));
    expect(setup.accounts.filter((a) => a.isDefaultAr).map((a) => a.number)).toEqual(["1310"]);
    const locationCount = await withTenant(seeded, (tx) => tx.select().from(locations));
    expect(setup.sites).toHaveLength(locationCount.length);
    expect(setup.sites.every((s) => s.locationName !== null)).toBe(true);
  });

  it("link payer classes to the practice's payers by regime", async () => {
    const rows = await withTenant(seeded, (tx) =>
      tx
        .select({ code: payerClasses.code, regime: payers.regime })
        .from(payerClasses)
        .innerJoin(payers, eq(payers.id, payerClasses.payerId)),
    );
    const mcr = rows.find((r) => r.code === "MCR");
    expect(mcr?.regime).toBe("medicare");
    for (const row of rows) expect(row.regime).toBeTruthy();
  });

  it("load into a working engine", async () => {
    const classify = prepareEngine(await withTenant(seeded, (tx) => loadEngineConfig(tx)));
    const result = classify({
      status: "PAID",
      payerClass: "SPY",
      cpt: "99213",
      description: "Visit",
      facility: "Clinic",
      billedCents: 12_000,
    });
    expect(result).toMatchObject({ ruleCode: "SELF_PAY", arGl: "1320", revenueGl: "5410" });
  });

  it("never overwrite an existing configuration", async () => {
    const created = await withTenant(seeded, (tx) => seedRevenueCycleDefaults(tx, seeded.tenantId));
    expect(created).toBe(false);
    const rules = await withTenant(seeded, (tx) => tx.select().from(businessRules));
    expect(rules).toHaveLength(DEFAULT_RULES.length);
  });

  it("can be loaded into a practice that has none, without locations or payers", async () => {
    expect(await withTenant(empty, (tx) => seedRevenueCycleDefaults(tx, empty.tenantId))).toBe(true);
    const setup = await withTenant(empty, (tx) => ledgerSetup(tx));
    expect(setup.rules).toHaveLength(12);
    expect(setup.sites).toHaveLength(0);
    expect(setup.classes.every((c) => c.payerName === null)).toBe(true);
  });
});

describe("revenue cycle constraints", () => {
  it("reject contra percentages outside 0–100%", async () => {
    await expectDbError(
      withTenant(seeded, (tx) =>
        tx.update(businessRules).set({ contraBps: 10_001 }).where(eq(businessRules.code, "STANDARD")),
      ),
      /contra_bps_range/,
    );
  });

  it("allow only one default AR account per practice", async () => {
    await expectDbError(
      withTenant(seeded, (tx) =>
        tx.update(glAccounts).set({ isDefaultAr: true }).where(eq(glAccounts.number, "1320")),
      ),
      /one_default_ar/,
    );
  });

  it("require AR accounts to say where revenue and adjustments post", async () => {
    await expectDbError(
      withTenant(seeded, (tx) =>
        tx
          .insert(glAccounts)
          .values({ tenantId: seeded.tenantId, number: "1399", name: "Bad AR", kind: "ar" }),
      ),
      /ar_routing/,
    );
  });

  it("forbid deleting rules (deactivate instead)", async () => {
    await expectDbError(
      withTenant(seeded, (tx) => tx.delete(businessRules)),
      /permission denied/,
    );
    await expectDbError(
      withTenant(seeded, (tx) => tx.delete(rcmSites)),
      /permission denied/,
    );
  });
});
