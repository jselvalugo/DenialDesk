import { asc, count, eq, sql } from "drizzle-orm";
import { canConfigureRevenueCycle } from "@/auth/permissions";
import type { Role } from "@/auth/session";
import { withTenant, type TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import { businessRules, glAccounts, locations, payerClasses, payers, rcmSites } from "@/db/schema";
import { DEFAULT_GL_ACCOUNTS, DEFAULT_PAYER_CLASSES, DEFAULTS_SOURCE, DEFAULT_RULES } from "./defaults";
import { EngineConfigError, ruleMatchSchema, type EngineConfig } from "./engine";

/**
 * Seeds DenialDesk's starter ledger configuration for the current tenant and audits it. Does
 * nothing when the practice already has business rules, so it never overwrites a practice's own
 * configuration. Serialized per tenant, so concurrent calls load the defaults once. Returns whether
 * anything was created.
 */
export async function seedRevenueCycleDefaults(
  tx: TenantTx,
  tenantId: string,
  actorUserId: string,
): Promise<boolean> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rcm_defaults:${tenantId}`}))`);
  const [{ rules } = { rules: 0 }] = await tx.select({ rules: count() }).from(businessRules);
  if (rules > 0) return false;

  await tx
    .insert(glAccounts)
    .values(
      DEFAULT_GL_ACCOUNTS.map((a) => ({
        tenantId,
        number: a.number,
        name: a.name,
        kind: a.kind,
        revenueGl: a.revenueGl ?? null,
        adjustmentGl: a.adjustmentGl ?? null,
        isDefaultAr: a.isDefaultAr ?? false,
        isPaymentsClearing: a.isPaymentsClearing ?? false,
      })),
    )
    .onConflictDoNothing();

  // Link classes to the practice's DenialDesk payers by regulatory regime (first payer by name).
  const practicePayers = await tx
    .select({ id: payers.id, regime: payers.regime })
    .from(payers)
    .orderBy(asc(payers.name));
  const payerFor = (regime: string | undefined) =>
    regime ? (practicePayers.find((p) => p.regime === regime)?.id ?? null) : null;
  await tx
    .insert(payerClasses)
    .values(
      DEFAULT_PAYER_CLASSES.map((pc) => ({
        tenantId,
        code: pc.code,
        name: pc.name,
        arGl: pc.arGl,
        payerId: payerFor(pc.regime),
      })),
    )
    .onConflictDoNothing();

  // One accounting site per DenialDesk location, coded 00, 01, … in name order.
  const practiceLocations = await tx
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .orderBy(asc(locations.name));
  if (practiceLocations.length > 0) {
    await tx
      .insert(rcmSites)
      .values(
        practiceLocations.map((l, i) => ({
          tenantId,
          code: String(i).padStart(2, "0"),
          name: l.name,
          locationId: l.id,
        })),
      )
      .onConflictDoNothing();
  }

  await tx.insert(businessRules).values(
    DEFAULT_RULES.map((r) => ({
      tenantId,
      code: r.code,
      name: r.name,
      description: r.description,
      priority: r.priority,
      match: r.match,
      arGl: r.arGl,
      revenueGl: r.revenueGl,
      adjustmentGl: r.adjustmentGl,
      source: DEFAULTS_SOURCE,
    })),
  );
  await audit(tx, {
    action: "rcm.defaults_loaded",
    actorUserId,
    tenantId,
    entityType: "tenant",
    entityId: tenantId,
    reason: "Default accounting configuration",
    metadata: { rules: DEFAULT_RULES.length, source: DEFAULTS_SOURCE },
  });
  return true;
}

export type LoadDefaultsResult = { ok: true } | { ok: false; error: string };

/** The "Load the default rule set" action: administrators only, practices without rules only. */
export async function loadDefaultRuleSet(auth: {
  tenantId: string;
  userId: string;
  role: Role;
}): Promise<LoadDefaultsResult> {
  if (!canConfigureRevenueCycle(auth.role)) {
    return { ok: false, error: "Only administrators can set up accounting rules." };
  }
  const created = await withTenant(auth, (tx) => seedRevenueCycleDefaults(tx, auth.tenantId, auth.userId));
  return created ? { ok: true } : { ok: false, error: "This practice already has accounting rules." };
}

/** Reads and validates the tenant's configuration for the rules engine. */
export async function loadEngineConfig(tx: TenantTx): Promise<EngineConfig> {
  const [rules, classes, accounts] = await Promise.all([
    tx.select().from(businessRules).orderBy(asc(businessRules.priority)),
    tx.select({ code: payerClasses.code, arGl: payerClasses.arGl }).from(payerClasses),
    tx.select().from(glAccounts).where(eq(glAccounts.kind, "ar")),
  ]);
  const defaultAr = accounts.find((a) => a.isDefaultAr);
  if (!defaultAr) throw new EngineConfigError("Set a default AR account before processing claims.");
  return {
    rules: rules.map((r) => {
      const match = ruleMatchSchema.safeParse(r.match);
      if (!match.success) throw new EngineConfigError(`Rule ${r.code} has invalid conditions.`);
      return { ...r, match: match.data };
    }),
    payerClasses: classes,
    // Non-null: the gl_accounts_ar_routing check constraint requires both on AR accounts.
    arAccounts: accounts.map((a) => ({
      number: a.number,
      revenueGl: a.revenueGl!,
      adjustmentGl: a.adjustmentGl!,
    })),
    defaultArGl: defaultAr.number,
  };
}

export async function ledgerSetup(tx: TenantTx) {
  const [rules, accounts, classes, sites] = await Promise.all([
    tx.select().from(businessRules).orderBy(asc(businessRules.priority)),
    tx.select().from(glAccounts).orderBy(asc(glAccounts.number)),
    tx
      .select({
        id: payerClasses.id,
        code: payerClasses.code,
        name: payerClasses.name,
        arGl: payerClasses.arGl,
        payerName: payers.name,
      })
      .from(payerClasses)
      .leftJoin(payers, eq(payers.id, payerClasses.payerId))
      .orderBy(asc(payerClasses.code)),
    tx
      .select({ id: rcmSites.id, code: rcmSites.code, name: rcmSites.name, locationName: locations.name })
      .from(rcmSites)
      .leftJoin(locations, eq(locations.id, rcmSites.locationId))
      .orderBy(asc(rcmSites.code)),
  ]);
  return { rules, accounts, classes, sites };
}
