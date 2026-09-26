import { inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { canViewRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { rcmFiles } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { periodFiles } from "@/domain/revenue-cycle/periods";
import { depositsForPayments, depositsToCsv } from "@/domain/revenue-cycle/synthetic-file";
import { syntheticDataOnly } from "@/lib/env";

/** Synthetic bank deposits matching this practice's imported months (synthetic-only; no PHI). */
export async function GET() {
  if (!syntheticDataOnly()) notFound();
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  const months = await withTenant(auth, async (tx) => {
    const periods = await periodFiles(tx);
    if (periods.length === 0) return [];
    const totals = await tx
      .select({ id: rcmFiles.id, paymentsCents: rcmFiles.paymentCents })
      .from(rcmFiles)
      .where(
        inArray(
          rcmFiles.id,
          periods.map((p) => p.fileId),
        ),
      );
    const byId = new Map(totals.map((t) => [t.id, t.paymentsCents]));
    return periods.map((p) => ({
      periodYear: p.periodYear,
      periodMonth: p.periodMonth,
      paymentsCents: byId.get(p.fileId)!,
    }));
  });
  return new Response(depositsToCsv(depositsForPayments(months, Date.now() % 100_000)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="synthetic-deposits.csv"',
      "Cache-Control": "no-store",
    },
  });
}
