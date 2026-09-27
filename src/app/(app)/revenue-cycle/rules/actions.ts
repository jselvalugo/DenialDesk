"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/auth/session";
import { loadDefaultRuleSet } from "@/domain/revenue-cycle/setup";
import { getT } from "@/i18n/server";

export interface LoadDefaultsState {
  error?: string;
}

/** Loads DenialDesk's starter rules and ledger for a practice that has none yet. */
export async function loadDefaultRules(): Promise<LoadDefaultsState> {
  const auth = await requireAuth();
  const t = await getT("revenue");
  const result = await loadDefaultRuleSet(auth, t);
  if (result.ok) revalidatePath("/revenue-cycle/rules");
  return result.ok ? {} : { error: result.error };
}
