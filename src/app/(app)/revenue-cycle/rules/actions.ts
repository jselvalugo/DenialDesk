"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { canManageRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { seedRevenueCycleDefaults } from "@/domain/revenue-cycle/setup";
import { audit } from "@/lib/audit";

export interface LoadDefaultsState {
  error?: string;
}

/** Loads the RevCycle IQ default rules and ledger for a practice that has none yet. */
export async function loadDefaultRules(): Promise<LoadDefaultsState> {
  const auth = await requireAuth();
  if (!canManageRevenueCycle(auth.role)) {
    return { error: "Only administrators and RCM managers can set up accounting rules." };
  }
  const created = await withTenant(auth, async (tx) => {
    // Serialize concurrent clicks within the practice so the defaults load once.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rcm_defaults:${auth.tenantId}`}))`);
    const created = await seedRevenueCycleDefaults(tx, auth.tenantId);
    if (created) {
      await audit(tx, {
        action: "rcm.defaults_loaded",
        actorUserId: auth.userId,
        tenantId: auth.tenantId,
        entityType: "tenant",
        entityId: auth.tenantId,
      });
    }
    return created;
  });
  revalidatePath("/revenue-cycle/rules");
  return created ? {} : { error: "This practice already has accounting rules." };
}
