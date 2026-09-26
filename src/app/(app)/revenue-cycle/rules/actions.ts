"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/auth/session";
import { loadDefaultRuleSet } from "@/domain/revenue-cycle/setup";

export interface LoadDefaultsState {
  error?: string;
}

/** Loads the RevCycle IQ default rules and ledger for a practice that has none yet. */
export async function loadDefaultRules(): Promise<LoadDefaultsState> {
  const auth = await requireAuth();
  const result = await loadDefaultRuleSet(auth);
  if (result.ok) revalidatePath("/revenue-cycle/rules");
  return result.ok ? {} : { error: result.error };
}
