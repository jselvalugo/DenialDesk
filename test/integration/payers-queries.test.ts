import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { closeDatabase } from "@/db/client";
import { payers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { getPayer, listPayers } from "@/domain/payers/queries";
import { createTestTenant } from "./helpers";

// docs/specs/settings-and-custom-fields.md S2 PR4: the read-only queries behind /settings/payers
// and /settings/payers/[id]. Tenant-scoped via `withTenant`; no PHI, so no audit expectations here
// (payer-catalog.md P1: payer names/EDI payer IDs/regimes are public or internal reference data).

afterAll(() => closeDatabase());

describe("listPayers", () => {
  it("returns the tenant's payers alphabetically, each with a verified flag", async () => {
    const tenant = await createTestTenant("Payer queries list");
    await withTenant(tenant, (tx) =>
      tx.insert(payers).values([
        { tenantId: tenant.tenantId, name: "Zeta Health", ediPayerId: null, regime: null },
        { tenantId: tenant.tenantId, name: "Aetna", ediPayerId: "60054", regime: "fl_insurer" },
        { tenantId: tenant.tenantId, name: "Mid Plan", ediPayerId: "12345", regime: null },
      ]),
    );

    const rows = await withTenant(tenant, (tx) => listPayers(tx));
    expect(rows.map((r) => r.name)).toEqual(["Aetna", "Mid Plan", "Zeta Health"]);
    expect(rows.find((r) => r.name === "Aetna")?.verified).toBe(true);
    // Missing an EDI payer id, missing a regime, or missing both are all unverified.
    expect(rows.find((r) => r.name === "Mid Plan")?.verified).toBe(false);
    expect(rows.find((r) => r.name === "Zeta Health")?.verified).toBe(false);
  });

  it("is tenant-isolated: another tenant's payers never appear", async () => {
    const alpha = await createTestTenant("Payer queries iso alpha");
    const beta = await createTestTenant("Payer queries iso beta");
    await withTenant(alpha, (tx) =>
      tx.insert(payers).values({ tenantId: alpha.tenantId, name: "Alpha Only Payer" }),
    );
    const betaRows = await withTenant(beta, (tx) => listPayers(tx));
    expect(betaRows.some((r) => r.name === "Alpha Only Payer")).toBe(false);
  });
});

describe("getPayer", () => {
  it("returns one payer by id for its own tenant, with the verified flag set", async () => {
    const tenant = await createTestTenant("Payer queries get");
    const [row] = await withTenant(tenant, (tx) =>
      tx
        .insert(payers)
        .values({ tenantId: tenant.tenantId, name: "Verified Co", ediPayerId: "111", regime: "fl_insurer" })
        .returning({ id: payers.id }),
    );
    const payer = await withTenant(tenant, (tx) => getPayer(tx, row!.id));
    expect(payer).toMatchObject({ id: row!.id, name: "Verified Co", verified: true });
  });

  it("returns null for a random id that names no payer", async () => {
    const tenant = await createTestTenant("Payer queries missing");
    const payer = await withTenant(tenant, (tx) => getPayer(tx, randomUUID()));
    expect(payer).toBeNull();
  });

  it("returns null for another tenant's payer id (RLS), the exact case the save action's pre-check relies on", async () => {
    const alpha = await createTestTenant("Payer queries cross alpha");
    const beta = await createTestTenant("Payer queries cross beta");
    const [alphaPayer] = await withTenant(alpha, (tx) =>
      tx
        .insert(payers)
        .values({ tenantId: alpha.tenantId, name: "Alpha's Payer" })
        .returning({ id: payers.id }),
    );
    const asBeta = await withTenant(beta, (tx) => getPayer(tx, alphaPayer!.id));
    expect(asBeta).toBeNull();
    // The same row, read back under its own tenant, is still there and unaffected.
    const asAlpha = await withTenant(alpha, (tx) => getPayer(tx, alphaPayer!.id));
    expect(asAlpha).not.toBeNull();
  });
});
