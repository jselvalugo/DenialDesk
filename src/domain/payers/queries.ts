import { asc, desc, eq } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { payers } from "@/db/schema";
import { isPayerVerified } from "./verification";

/** Sortable list columns (P4, docs/specs/record-pages.md); today, only one. */
export const PAYER_SORT_KEYS = ["name"] as const;
export type PayerSortKey = (typeof PAYER_SORT_KEYS)[number];
export const PAYER_SORT_DEFAULT_DIR: Record<PayerSortKey, "asc" | "desc"> = { name: "asc" };

// Read-only payer record under Settings (docs/specs/settings-and-custom-fields.md S2 PR4;
// docs/specs/payer-catalog.md). Payer names, EDI payer IDs, and regimes are public/internal
// reference data, not PHI (payer-catalog P1); this module never touches a custom field's stored
// value — that decryption lives only in the values domain module and its list-columns sibling
// (a guard test in test/integration/custom-field-values.test.ts asserts this file never imports it).

export interface PayerListRow {
  id: string;
  name: string;
  ediPayerId: string | null;
  regime: string | null;
  source: string | null;
  verified: boolean;
}

/**
 * Every payer on this tenant, alphabetical by name (spec: settings-and-custom-fields.md S2 PR4), or
 * reversed when `dir` is `"desc"` (P4 sortable header); a stable `id` tie-break keeps ties deterministic.
 */
export async function listPayers(
  tx: TenantTx,
  dir: "asc" | "desc" = PAYER_SORT_DEFAULT_DIR.name,
): Promise<PayerListRow[]> {
  const order = dir === "asc" ? [asc(payers.name), asc(payers.id)] : [desc(payers.name), asc(payers.id)];
  const rows = await tx
    .select({
      id: payers.id,
      name: payers.name,
      ediPayerId: payers.ediPayerId,
      regime: payers.regime,
      source: payers.source,
    })
    .from(payers)
    .orderBy(...order);
  return rows.map((p) => ({ ...p, verified: isPayerVerified(p) }));
}

export interface PayerRecord {
  id: string;
  name: string;
  ediPayerId: string | null;
  regime: string | null;
  source: string | null;
  createdAt: Date;
  verified: boolean;
}

/** One payer for the record page (`/settings/payers/[id]`), or `null` if it's not this tenant's. */
export async function getPayer(tx: TenantTx, id: string): Promise<PayerRecord | null> {
  const [row] = await tx
    .select({
      id: payers.id,
      name: payers.name,
      ediPayerId: payers.ediPayerId,
      regime: payers.regime,
      source: payers.source,
      createdAt: payers.createdAt,
    })
    .from(payers)
    .where(eq(payers.id, id))
    .limit(1);
  if (!row) return null;
  return { ...row, verified: isPayerVerified(row) };
}
