import { sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { payers } from "@/db/schema";
import { FLORIDA_PAYER_CATALOG } from "./florida-catalog";

/**
 * Gives the current tenant every starter-catalog payer it doesn't already have, matched by name
 * case-insensitively so a practice's own "Florida Blue" isn't duplicated. Idempotent across
 * sequential calls: safe to run on every practice setup and from the seed. There is no unique
 * constraint on `(tenant_id, name)`, so this takes a per-tenant advisory lock itself (distinct key
 * from `rcm_defaults:<tenant>` in `revenue-cycle/setup.ts`, so the two never contend) rather than
 * relying on callers to serialize it — a genuinely concurrent pair of calls could otherwise both
 * read "missing" before either inserts and double the catalog rows for that tenant.
 *
 * Catalog payers are unverified (no EDI payer ID or regime) until a human confirms them (P2).
 * Payer names are public reference data, not PHI (spec: payer-catalog P1); callers that insert one
 * or more rows should still emit an audit event recording the count, since it changes tenant data
 * (see `seedRevenueCycleDefaults`).
 *
 * A payer a practice later deletes or renames off this list reappears the next time setup runs,
 * since this only ever adds what's missing by name (spec Open questions).
 */
export async function ensureCatalogPayers(tx: TenantTx, tenantId: string): Promise<number> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`payer_catalog:${tenantId}`}))`);
  const existing = await tx.select({ name: payers.name }).from(payers);
  const existingNames = new Set(existing.map((p) => p.name.trim().toLowerCase()));
  const missing = FLORIDA_PAYER_CATALOG.filter((c) => !existingNames.has(c.name.trim().toLowerCase()));
  if (missing.length === 0) return 0;

  await tx.insert(payers).values(
    missing.map((c) => ({
      tenantId,
      name: c.name,
      ediPayerId: null,
      regime: null,
      source: c.source,
    })),
  );
  return missing.length;
}
