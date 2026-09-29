import { asc, eq } from "drizzle-orm";
import { locations, providers } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { canConfigureSettings } from "@/auth/permissions";
import type { Role } from "@/auth/session";
import { decryptProviderTin, encryptProviderTin } from "@/lib/crypto/provider-tin";
import { audit } from "@/lib/audit";
import type { MessageKey } from "@/i18n/messages/types";
import { BILLING_LIMITS } from "./billing-limits";

// Provider billing details and location place of service (docs/specs/claims.md C3a-S). The values the 837P
// generator reads (loop 2010AA, CLM05-1). Validation mirrors the CHECKs of migration 0046 and the generator's
// own shapes, so a value saved here is one the database accepts. A TIN is write-only: it is encrypted on
// write, bound to its provider, never returned, never logged, and never in an audit row (only field names).

export type BillingErrorKey = MessageKey<"settings"> & `billing.error.${string}`;

export type ProviderBillingField =
  "firstName" | "lastName" | "addressLine1" | "city" | "state" | "postalCode" | "tinType" | "tin";
export type BillingField = ProviderBillingField | "placeOfService";

export interface BillingIssue {
  field: BillingField;
  key: BillingErrorKey;
  /** Numeric only (a limit), never user input. */
  max?: number;
}

export type BillingFailure = "forbidden" | "validation" | "step_up" | "not_found";

/** A refusal: `kind` says why, `issues` (validation only) name the fields, never their values. */
export class BillingSettingsError extends Error {
  constructor(
    readonly kind: BillingFailure,
    readonly issues: readonly BillingIssue[] = [],
  ) {
    super(`billing settings refused: ${kind}`);
    this.name = "BillingSettingsError";
  }
}

export interface BillingActor {
  tenantId: string;
  userId: string;
  role: Role;
  /** From the session's own `mfa_verified_at` (R-7.2.2), never the request. */
  recentMfa: boolean;
  stepUpVerifiedAt?: string | null;
}

export { BILLING_LIMITS };

// Same character set as the 837P generator's `TEXT_OK` (src/edi/x12/837p.ts); a test keeps them in step.
const X12_TEXT = /^[A-Z0-9 &'(),.\-/#]+$/;
const PO_BOX = /^(P\.?\s?O\.?\s?BOX|POST OFFICE BOX|LOCKBOX)\b/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Upper-case, accents removed, blanks collapsed: what X12 carries. Never drops a character it cannot carry. */
function clean(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase().replace(/\s+/g, " ").trim();
}

type Cleaned = { value: string } | { key: BillingErrorKey; max?: number };

/** Trimmed X12-safe text within `max`, or the reason it is refused. */
export function cleanBillingText(raw: string, max: number): Cleaned {
  const value = clean(raw);
  if (value === "") return { key: "billing.error.required" };
  if (!X12_TEXT.test(value)) return { key: "billing.error.characters" };
  if (value.length > max) return { key: "billing.error.tooLong", max };
  return { value };
}

/** `^[0-9]{5}(-?[0-9]{4})?$` (the database CHECK); stored without the hyphen. */
export function cleanPostalCode(raw: string): string | null {
  const value = raw.trim();
  return /^[0-9]{5}(-?[0-9]{4})?$/.test(value) ? value.replace("-", "") : null;
}

/** Nine digits once every hyphen and space is dropped (12-3456789, 123-45-6789, 123 45 6789); anything else is refused. */
export function cleanTin(raw: string): string | null {
  const value = raw.trim().replace(/[- ]/g, "");
  return /^[0-9]{9}$/.test(value) ? value : null;
}

/** Two digits, format only. ⚠️ VERIFY against the CMS place of service code set (claims.md C3a-S, OA-092). */
export function cleanPlaceOfService(raw: string): string | null {
  const value = raw.trim();
  return /^[0-9]{2}$/.test(value) ? value : null;
}

export interface ProviderBillingInput {
  firstName: string;
  lastName: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  /** "EI", "SY", or "" (unset). */
  tinType: string;
  /** Empty means "leave the stored TIN alone". Never echoed back. */
  tin: string;
}

interface ProviderValues {
  firstName: string;
  lastName: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
}

/** Validates the fields that don't depend on the stored row. Pure. */
export function validateProviderFields(
  input: ProviderBillingInput,
): { values: ProviderValues; issues: [] } | { values?: undefined; issues: BillingIssue[] } {
  const issues: BillingIssue[] = [];
  const out: Partial<ProviderValues> = {};
  for (const field of ["firstName", "lastName", "addressLine1", "city"] as const) {
    const result = cleanBillingText(input[field], BILLING_LIMITS[field]);
    if ("value" in result) out[field] = result.value;
    else issues.push({ field, key: result.key, ...(result.max ? { max: result.max } : {}) });
  }
  if (out.addressLine1 !== undefined && PO_BOX.test(out.addressLine1)) {
    issues.push({ field: "addressLine1", key: "billing.error.poBox" });
  }
  const state = input.state.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(state)) out.state = state;
  else issues.push({ field: "state", key: "billing.error.state" });
  const zip = cleanPostalCode(input.postalCode);
  if (zip !== null) out.postalCode = zip;
  else issues.push({ field: "postalCode", key: "billing.error.zip" });
  if (input.tinType !== "" && input.tinType !== "EI" && input.tinType !== "SY") {
    issues.push({ field: "tinType", key: "billing.error.tinType" });
  }
  if (input.tin.trim() !== "" && cleanTin(input.tin) === null) {
    issues.push({ field: "tin", key: "billing.error.tin" });
  }
  return issues.length > 0 ? { issues } : { values: out as ProviderValues, issues: [] };
}

function requireAdmin(actor: BillingActor): void {
  if (!canConfigureSettings(actor.role)) throw new BillingSettingsError("forbidden");
}

function requireId(id: string): void {
  if (!UUID.test(id)) throw new BillingSettingsError("not_found");
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** What is still missing for the 837P, by field. Names only. */
export type MissingField =
  "firstName" | "lastName" | "addressLine1" | "city" | "state" | "postalCode" | "tin";

export interface ProviderListRow {
  id: string;
  name: string;
  npi: string;
  missing: MissingField[];
}

export interface LocationListRow {
  id: string;
  name: string;
  city: string;
  placeOfService: string | null;
}

/** At most this many of each are listed (SC-B5.4). */
export const BILLING_LIST_LIMIT = 200;

/**
 * The practice's providers and locations with what is missing. A ZIP counts only with nine digits (the 837P
 * billing loop needs ZIP+4), and a TIN that is on file but can't be decrypted counts as missing. Checking that
 * decrypts each stored TIN in memory (nothing is returned from it), so when any was, one
 * `settings.provider_billing_viewed` event records the read (`phi: tin_readable_check`, with a count).
 */
export async function listBillingTargets(
  tx: TenantTx,
  actor: BillingActor,
): Promise<{ providers: ProviderListRow[]; locations: LocationListRow[] }> {
  requireAdmin(actor);
  const providerRows = await tx
    .select({
      id: providers.id,
      name: providers.name,
      npi: providers.npi,
      firstName: providers.firstName,
      lastName: providers.lastName,
      addressLine1: providers.addressLine1,
      city: providers.city,
      state: providers.state,
      postalCode: providers.postalCode,
      tinType: providers.tinType,
      tinEnc: providers.tinEnc,
    })
    .from(providers)
    .orderBy(asc(providers.name), asc(providers.id))
    .limit(BILLING_LIST_LIMIT);
  const locationRows = await tx
    .select({
      id: locations.id,
      name: locations.name,
      city: locations.city,
      placeOfService: locations.placeOfService,
    })
    .from(locations)
    .orderBy(asc(locations.name), asc(locations.id))
    .limit(BILLING_LIST_LIMIT);
  let decrypted = 0;
  const providerList = providerRows.map((row) => {
    const missing: MissingField[] = [];
    for (const field of ["firstName", "lastName", "addressLine1", "city", "state"] as const) {
      if (row[field] === null) missing.push(field);
    }
    if (row.postalCode === null || !/^[0-9]{9}$/.test(row.postalCode)) missing.push("postalCode");
    let readable = false;
    if (row.tinType !== null && row.tinEnc !== null) {
      decrypted += 1;
      try {
        readable = /^[0-9]{9}$/.test(decryptProviderTin(row.tinEnc, actor.tenantId, row.id));
      } catch {
        readable = false;
      }
    }
    if (!readable) missing.push("tin");
    return { id: row.id, name: row.name, npi: row.npi, missing };
  });
  if (decrypted > 0) {
    await audit(tx, {
      action: "settings.provider_billing_viewed",
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      entityType: "provider",
      reason: "billing_settings",
      metadata: { phi: "tin_readable_check", provider_count: decrypted },
    });
  }
  return {
    providers: providerList,
    locations: locationRows,
  };
}

export interface ProviderBillingView {
  id: string;
  name: string;
  npi: string;
  firstName: string;
  lastName: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  tinType: "EI" | "SY" | null;
  /** Last four digits, or "unreadable" when the stored value fails to decrypt; null when no TIN is on file. */
  tinLast4: string | "unreadable" | null;
}

/**
 * One provider's details for the form. Decrypts the TIN in memory for its last four only, and audits that
 * read (`settings.provider_billing_viewed`, R-7.5.1). Null when the provider is not this practice's.
 */
export async function getProviderBilling(
  tx: TenantTx,
  actor: BillingActor,
  providerId: string,
): Promise<ProviderBillingView | null> {
  requireAdmin(actor);
  if (!UUID.test(providerId)) return null;
  const [row] = await tx.select().from(providers).where(eq(providers.id, providerId)).limit(1);
  if (!row) return null;
  let tinLast4: ProviderBillingView["tinLast4"] = null;
  if (row.tinEnc !== null) {
    try {
      tinLast4 = decryptProviderTin(row.tinEnc, actor.tenantId, row.id).slice(-4);
    } catch {
      tinLast4 = "unreadable";
    }
  }
  await audit(tx, {
    action: "settings.provider_billing_viewed",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "provider",
    entityId: row.id,
    reason: "billing_settings",
    metadata: {
      phi: row.tinEnc === null ? "none" : tinLast4 === "unreadable" ? "tin_unreadable" : "tin_last4",
    },
  });
  return {
    id: row.id,
    name: row.name,
    npi: row.npi,
    firstName: row.firstName ?? "",
    lastName: row.lastName ?? "",
    addressLine1: row.addressLine1 ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    postalCode: row.postalCode ?? "",
    tinType: row.tinType === "EI" || row.tinType === "SY" ? row.tinType : null,
    tinLast4,
  };
}

export async function getLocationBilling(
  tx: TenantTx,
  actor: BillingActor,
  locationId: string,
): Promise<LocationListRow | null> {
  requireAdmin(actor);
  if (!UUID.test(locationId)) return null;
  const [row] = await tx
    .select({
      id: locations.id,
      name: locations.name,
      city: locations.city,
      placeOfService: locations.placeOfService,
    })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------------------------

const COLUMN_NAMES = {
  firstName: "first_name",
  lastName: "last_name",
  addressLine1: "address_line1",
  city: "city",
  state: "state",
  postalCode: "postal_code",
  tinType: "tin_type",
  tin: "tin",
} as const satisfies Record<ProviderBillingField, string>;

/**
 * Saves a provider's billing details. Admin only; a TIN set or changed (or a changed TIN type) needs a recent
 * MFA (`actor.recentMfa`). The change and its audit event commit together (HC-5.2). Returns the column names
 * that changed (empty: nothing written, nothing audited).
 */
export async function updateProviderBilling(
  tx: TenantTx,
  actor: BillingActor,
  providerId: string,
  input: ProviderBillingInput,
): Promise<{ changed: string[] }> {
  requireAdmin(actor);
  requireId(providerId);
  const checked = validateProviderFields(input);
  if (checked.issues.length > 0) throw new BillingSettingsError("validation", checked.issues);
  const values = checked.values!;

  const [current] = await tx.select().from(providers).where(eq(providers.id, providerId)).for("update");
  if (!current) throw new BillingSettingsError("not_found");

  // The TIN and its type are stored together or not at all (providers_tin_together); a stored TIN can be
  // replaced, never cleared.
  const newTin = input.tin.trim() === "" ? null : cleanTin(input.tin);
  const issues: BillingIssue[] = [];
  if (current.tinEnc !== null && input.tinType === "")
    issues.push({ field: "tinType", key: "billing.error.tinType" });
  if (current.tinEnc === null) {
    if (newTin !== null && input.tinType === "")
      issues.push({ field: "tinType", key: "billing.error.tinType" });
    if (newTin === null && input.tinType !== "")
      issues.push({ field: "tin", key: "billing.error.tinRequired" });
  }
  if (issues.length > 0) throw new BillingSettingsError("validation", issues);

  const typeChanged = current.tinEnc !== null && input.tinType !== "" && input.tinType !== current.tinType;
  // Typing a TIN, or changing the type of the stored one, is a TIN change: it needs a recent MFA. This comes
  // before the stored value is decrypted for the comparison below.
  if ((newTin !== null || typeChanged) && !actor.recentMfa) throw new BillingSettingsError("step_up");

  // Typing the TIN that is already stored is not a change: no write, no audit. (Decrypting here is acceptable
  // because a new TIN was typed; an unreadable stored value simply counts as different.)
  let tinValueChanged = newTin !== null;
  if (newTin !== null && current.tinEnc !== null) {
    try {
      tinValueChanged = decryptProviderTin(current.tinEnc, actor.tenantId, current.id) !== newTin;
    } catch {
      tinValueChanged = true;
    }
  }

  const changed: ProviderBillingField[] = [];
  const set: Partial<typeof providers.$inferInsert> = {};
  for (const field of ["firstName", "lastName", "addressLine1", "city", "state", "postalCode"] as const) {
    if (current[field] !== values[field]) {
      changed.push(field);
      set[field] = values[field];
    }
  }
  if (tinValueChanged) {
    // Type and ciphertext are stored together (providers_tin_together), in one statement.
    set.tinType = input.tinType;
    set.tinEnc = encryptProviderTin(newTin!, actor.tenantId, current.id);
    changed.push("tin");
    if (input.tinType !== current.tinType) changed.push("tinType");
  } else if (typeChanged) {
    // The AAD binds tenant, column, and provider, not the type, so the ciphertext stays as it is (and is not
    // decrypted, even if it can't be read).
    set.tinType = input.tinType;
    changed.push("tinType");
  }
  if (changed.length === 0) return { changed: [] };

  await tx.update(providers).set(set).where(eq(providers.id, current.id));
  const names = changed.map((field) => COLUMN_NAMES[field]);
  await audit(tx, {
    action: "settings.provider_billing_updated",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "provider",
    entityId: current.id,
    reason: "billing_settings",
    metadata: {
      fields: names.join(","),
      tin_changed: changed.includes("tin"),
      step_up_verified_at: tinValueChanged || typeChanged ? (actor.stepUpVerifiedAt ?? null) : null,
    },
  });
  return { changed: names };
}

/** Saves a location's place of service (two digits, format only ⚠️ VERIFY). Admin only. */
export async function updateLocationPlaceOfService(
  tx: TenantTx,
  actor: BillingActor,
  locationId: string,
  rawPlaceOfService: string,
): Promise<{ changed: string[] }> {
  requireAdmin(actor);
  requireId(locationId);
  const placeOfService = cleanPlaceOfService(rawPlaceOfService);
  if (placeOfService === null) {
    throw new BillingSettingsError("validation", [{ field: "placeOfService", key: "billing.error.pos" }]);
  }
  const [current] = await tx
    .select({ id: locations.id, placeOfService: locations.placeOfService })
    .from(locations)
    .where(eq(locations.id, locationId))
    .for("update");
  if (!current) throw new BillingSettingsError("not_found");
  if (current.placeOfService === placeOfService) return { changed: [] };
  await tx.update(locations).set({ placeOfService }).where(eq(locations.id, current.id));
  await audit(tx, {
    action: "settings.location_pos_updated",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "location",
    entityId: current.id,
    reason: "billing_settings",
    metadata: { fields: "place_of_service" },
  });
  return { changed: ["place_of_service"] };
}
