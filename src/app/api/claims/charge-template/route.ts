import { notFound } from "next/navigation";
import { canImportCharges } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { CHARGE_FILE_HEADER } from "@/domain/claims/charge-file";

/** The charge file's header row and nothing else: no data, so nothing to audit (docs/specs/claims.md C2). */
export async function GET() {
  const auth = await requireAuth();
  if (!canImportCharges(auth.role)) notFound();
  return new Response(`${CHARGE_FILE_HEADER.join(",")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="charge-import-template.csv"',
      "Cache-Control": "no-store",
    },
  });
}
