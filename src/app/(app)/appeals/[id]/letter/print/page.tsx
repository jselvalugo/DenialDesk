import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { canWorkAppeals } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Panel } from "@/components/ui/Panel";
import { secondaryLinkButtonClass } from "@/components/ui/linkButton";
import { withTenant } from "@/db/tenant";
import { prepareExport, recordExportRoleRefused, type ExportRefusal } from "@/domain/appeals/letter/service";
import type { MessageKey } from "@/i18n/messages/types";
import { getFormat, getT } from "@/i18n/server";
import { isProduction } from "@/lib/env";
import { PrintButton } from "./PrintButton";

// The page title becomes the suggested PDF file name, so it is generic and never carries PHI (HC-2.4).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("appeals");
  return { title: t("letter.print.title") };
}

const REFUSAL_KEYS: Record<Exclude<ExportRefusal, "not_found">, MessageKey<"appeals">> = {
  no_letter: "letter.print.refused.noLetter",
  not_attested: "letter.print.refused.notAttested",
  changed_since_review: "letter.print.refused.changed",
  sensitive_patient: "letter.print.refused.sensitive",
  role: "letter.print.refused.role",
};

/**
 * Print view of the reviewed letter (docs/specs/appeals.md A2). Opening it is the audited export
 * (HC-2.4): it renders only when the latest version has an attestation that still matches the letter.
 */
export default async function AppealLetterPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();
  const t = await getT("appeals");
  const f = await getFormat();

  // Compliance reads the letter but does not export it (R-5.1.2); the attempt is audited, not just hidden.
  const result = canWorkAppeals(auth.role)
    ? await withTenant(auth, (tx) => prepareExport(tx, auth, id))
    : await withTenant(auth, async (tx) => {
        await recordExportRoleRefused(tx, auth, id);
        return { ok: false, reason: "role" } as const;
      });
  if (!result.ok && result.reason === "not_found") notFound();

  if (!result.ok) {
    const key = REFUSAL_KEYS[result.reason as Exclude<ExportRefusal, "not_found">];
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Panel title={t("letter.print.refusedTitle")}>
          <p role="alert" className="text-body text-text">
            {t(key)}
          </p>
          <div className="mt-4">
            <Link href={`/appeals/${id}/letter`} className={secondaryLinkButtonClass}>
              {t("letter.print.back")}
            </Link>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[8.5in] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-label text-muted">
          {t("letter.print.reviewedBy", {
            version: result.version,
            name: result.attestedBy,
            when: f.dateTime(result.attestedAt),
          })}
        </p>
        <div className="flex items-center gap-2">
          <Link href={`/appeals/${id}/letter`} className={secondaryLinkButtonClass}>
            {t("letter.print.back")}
          </Link>
          <PrintButton />
        </div>
      </div>
      {!isProduction() && (
        // Printed on purpose: a pre-production letter holds synthetic data and must never be mistaken for one.
        <p className="text-center text-body font-bold tracking-wide text-black uppercase">
          {t("letter.print.syntheticMarker")}
        </p>
      )}
      <article className="rounded-panel border border-border bg-white px-10 py-10 font-serif text-[11pt] leading-relaxed whitespace-pre-wrap text-black shadow-xs print:rounded-none print:border-0 print:p-0 print:shadow-none">
        {result.text}
      </article>
    </div>
  );
}
