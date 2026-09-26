import { afterAll, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { closeDatabase } from "@/db/client";
import { payers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { ensureCatalogPayers } from "@/domain/payers/catalog";
import { FLORIDA_PAYER_CATALOG } from "@/domain/payers/florida-catalog";
import { createTestTenant } from "./helpers";

afterAll(() => closeDatabase());

describe("ensureCatalogPayers (spec: payer-catalog P1)", () => {
  it("adds every starter-catalog payer as unverified, and is idempotent", async () => {
    const tenant = await createTestTenant("Catalog");
    const inserted = await withTenant(tenant, (tx) => ensureCatalogPayers(tx, tenant.tenantId));
    expect(inserted).toBe(FLORIDA_PAYER_CATALOG.length);

    const rows = await withTenant(tenant, (tx) =>
      tx
        .select({
          name: payers.name,
          ediPayerId: payers.ediPayerId,
          regime: payers.regime,
          source: payers.source,
        })
        .from(payers)
        .orderBy(asc(payers.name)),
    );
    expect(rows).toHaveLength(FLORIDA_PAYER_CATALOG.length);
    for (const row of rows) {
      expect(row.ediPayerId).toBeNull();
      expect(row.regime).toBeNull();
      expect(row.source).toMatch(/⚠️ VERIFY/);
    }

    // Calling it again adds nothing more.
    const secondRun = await withTenant(tenant, (tx) => ensureCatalogPayers(tx, tenant.tenantId));
    expect(secondRun).toBe(0);
    const rowsAfter = await withTenant(tenant, (tx) => tx.select().from(payers));
    expect(rowsAfter).toHaveLength(FLORIDA_PAYER_CATALOG.length);
  });

  it("matches an existing payer name case-insensitively instead of duplicating it", async () => {
    const tenant = await createTestTenant("Catalog existing");
    const existing = FLORIDA_PAYER_CATALOG[0]!.name.toUpperCase();
    await withTenant(tenant, (tx) =>
      tx
        .insert(payers)
        .values({ tenantId: tenant.tenantId, name: existing, ediPayerId: "999", regime: "fl_insurer" }),
    );
    const inserted = await withTenant(tenant, (tx) => ensureCatalogPayers(tx, tenant.tenantId));
    expect(inserted).toBe(FLORIDA_PAYER_CATALOG.length - 1);

    const rows = await withTenant(tenant, (tx) => tx.select().from(payers).where(eq(payers.name, existing)));
    expect(rows).toHaveLength(1);
    // The practice's own verified entry is untouched, not overwritten by the catalog stub.
    expect(rows[0]!.ediPayerId).toBe("999");
    expect(rows[0]!.regime).toBe("fl_insurer");
  });

  it("keeps each tenant's catalog payers isolated from another tenant's", async () => {
    const a = await createTestTenant("Catalog tenant A");
    const b = await createTestTenant("Catalog tenant B");
    await withTenant(a, (tx) => ensureCatalogPayers(tx, a.tenantId));

    const bRows = await withTenant(b, (tx) => tx.select().from(payers));
    expect(bRows).toHaveLength(0);

    await withTenant(b, (tx) => ensureCatalogPayers(tx, b.tenantId));
    const aRows = await withTenant(a, (tx) => tx.select().from(payers));
    const bRowsAfter = await withTenant(b, (tx) => tx.select().from(payers));
    expect(aRows).toHaveLength(FLORIDA_PAYER_CATALOG.length);
    expect(bRowsAfter).toHaveLength(FLORIDA_PAYER_CATALOG.length);
  });
});
