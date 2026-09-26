import { notFound } from "next/navigation";
import { z } from "zod";
import { requireOperator } from "@/auth/operator";
import { openAgreementFile } from "@/domain/platform/agreements";

/** The signed copy of one agreement, as an attachment, for a verified operator session only. */
export async function GET(
  _: Request,
  { params }: { params: Promise<{ tenantId: string; agreementId: string }> },
) {
  const { tenantId, agreementId } = await params;
  if (!z.uuid().safeParse(tenantId).success || !z.uuid().safeParse(agreementId).success) notFound();
  const operator = await requireOperator();
  const file = await openAgreementFile(tenantId, agreementId, operator);
  if (!file) notFound();
  // The stored name is quoted with anything but safe characters replaced (never echoed raw).
  const safeName = file.filename.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120) || "agreement.pdf";
  return new Response(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.content.length),
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
