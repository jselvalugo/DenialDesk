import { notFound } from "next/navigation";
import { todayIn } from "@rules/calendar";
import { canViewRevenueCycle } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { rcmSites } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { generateMonthlyLines, monthlyLinesToCsv } from "@/domain/revenue-cycle/synthetic-file";
import { isProduction } from "@/lib/env";

/** A synthetic sample file for this practice's sites (pre-production only; no PHI). */
export async function GET() {
  if (isProduction()) notFound();
  const auth = await requireAuth();
  if (!canViewRevenueCycle(auth.role)) notFound();
  const sites = await withTenant(auth, (tx) => tx.select({ name: rcmSites.name }).from(rcmSites));
  const [year, month] = todayIn().split("-").map(Number) as [number, number];
  const csv = monthlyLinesToCsv(
    generateMonthlyLines({
      seed: Date.now() % 100_000,
      periodYear: year,
      periodMonth: month,
      facilities: sites.map((s) => s.name),
    }),
  );
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="synthetic-monthly-file-${year}-${String(month).padStart(2, "0")}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
