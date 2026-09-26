/**
 * Starter catalog of insurers and plans operating in Florida (R-2.2, §8.1, spec: payer-catalog P1).
 *
 * Names only — no payer IDs, no regulatory regimes. Every entry needs a human (the owner, or a
 * future payer admin) to confirm it against the cited source before it is used for anything beyond
 * "which insurer does this patient have" (CLAUDE.md #9). Until then a catalog payer is
 * **unverified**: `assertPayerVerified` refuses it for submission, and deadline math skips it.
 *
 * Versioned so a later catalog update is auditable; bump CATALOG_VERSION when entries change.
 */

export const CATALOG_VERSION = 1;

export interface CatalogPayer {
  /** Legal or commonly used plan name. Matched case-insensitively against `payers.name`. */
  name: string;
  /** Where the name came from. Always carries ⚠️ VERIFY until an admin confirms it (P2). */
  source: string;
}

const OIR_SOURCE = "FL OIR licensee list — ⚠️ VERIFY";
const SMMC_SOURCE = "AHCA SMMC plan list — ⚠️ VERIFY";
const CMS_SOURCE = "CMS — ⚠️ VERIFY";

/**
 * Starter list of well-known insurers and plans doing business in Florida. Not exhaustive; a
 * practice can still add a payer that isn't on this list.
 */
export const FLORIDA_PAYER_CATALOG: readonly CatalogPayer[] = [
  { name: "Florida Blue", source: OIR_SOURCE },
  { name: "UnitedHealthcare", source: OIR_SOURCE },
  { name: "Aetna", source: OIR_SOURCE },
  { name: "Cigna", source: OIR_SOURCE },
  { name: "Humana", source: OIR_SOURCE },
  { name: "AvMed", source: OIR_SOURCE },
  { name: "Oscar Health", source: OIR_SOURCE },
  { name: "Ambetter (Sunshine Health)", source: OIR_SOURCE },
  { name: "Molina Healthcare", source: OIR_SOURCE },
  { name: "Simply Healthcare", source: SMMC_SOURCE },
  { name: "Sunshine Health", source: SMMC_SOURCE },
  { name: "Humana Medical Plan (Medicaid)", source: SMMC_SOURCE },
  { name: "Staywell/Wellcare", source: SMMC_SOURCE },
  { name: "Community Care Plan", source: SMMC_SOURCE },
  { name: "Medicare Part B (First Coast Service Options)", source: CMS_SOURCE },
  { name: "Florida Medicaid (FFS)", source: SMMC_SOURCE },
  { name: "Tricare", source: "TRICARE regional contractor list — ⚠️ VERIFY" },
  { name: "CarePlus", source: OIR_SOURCE },
  { name: "Devoted Health", source: OIR_SOURCE },
  { name: "Capital Health Plan", source: OIR_SOURCE },
  { name: "Health First Health Plans", source: OIR_SOURCE },
  { name: "Neighborhood Health Partnership", source: OIR_SOURCE },
] as const;
