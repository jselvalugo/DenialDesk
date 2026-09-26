import { notFound } from "next/navigation";
import { canViewRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import { monthsWithoutDeposits } from "@/domain/revenue-cycle/receivables";
import { depositsForPayments, depositsToCsv } from "@/domain/revenue-cycle/synthetic-file";
import { syntheticDataOnly } from "@/lib/env";

/** Synthetic bank deposits for the practice's months without deposits (synthetic-only; no PHI). */
export async function GET() {
  if (!syntheticDataOnly()) notFound();
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  // Only months without deposits, so the sample never doubles what's already imported.
  const months = await withTenant(auth, (tx) => monthsWithoutDeposits(tx));
  if (months.length === 0) notFound();
  return new Response(depositsToCsv(depositsForPayments(months, Date.now() % 100_000)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="synthetic-deposits.csv"',
      "Cache-Control": "no-store",
    },
  });
}
