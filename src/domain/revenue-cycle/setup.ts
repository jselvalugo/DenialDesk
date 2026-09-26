import { asc, count, eq } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { businessRules, glAccounts, locations, payerClasses, payers, rcmSites } from "@/db/schema";
import { DEFAULT_GL_ACCOUNTS, DEFAULT_PAYER_CLASSES, DEFAULTS_SOURCE, DEFAULT_RULES } from "./defaults";
import { EngineConfigError, ruleMatchSchema, type EngineConfig } from "./engine";

/**
 * Seeds the RevCycle IQ default ledger configuration for the current tenant. Does nothing when the
 * practice already has business rules, so it never overwrites a practice's own configuration.
 * Returns whether anything was created.
 */
export async function seedRevenueCycleDefaults(tx: TenantTx, tenantId: string): Promise<boolean> {
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
      contraBps: r.contraBps,
      excluded: r.excluded,
      arGl: r.arGl,
      revenueGl: r.revenueGl,
      adjustmentGl: r.adjustmentGl,
      source: DEFAULTS_SOURCE,
    })),
  );
  return true;
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
