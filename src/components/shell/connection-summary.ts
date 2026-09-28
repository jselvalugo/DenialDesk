import "server-only";
import { cache } from "react";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import {
  getPatientsConnectionSummary,
  type PatientsConnectionSummary,
} from "@/domain/integrations/connections";

/**
 * The Patients data-source summary, request-memoized (React `cache()`, same pattern as
 * `requireAuth`/`getSession` in `src/auth/session.ts`). Both the signed-in layout (for the
 * tab-bar drop-down, `AppShell`) and the Patients pages themselves (for the "synced from …"
 * notice and the register-blocked check) need this; without memoization each request ran the
 * same one-row indexed query twice (security/correctness review PR #81, item 18). Takes no
 * arguments — like `requireAuth`, it reads the request's own session — so every call site within
 * one request shares the single cached result.
 */
export const loadPatientsConnectionSummary = cache(async (): Promise<PatientsConnectionSummary | null> => {
  const auth = await requireAuth();
  return withTenant(auth, (tx) => getPatientsConnectionSummary(tx));
});
