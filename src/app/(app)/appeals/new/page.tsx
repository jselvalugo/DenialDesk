import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { canWorkAppeals } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { claims, denials, payers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { firstLevelDeadline } from "@/domain/appeals/deadline";
import { openAppealsForDenial } from "@/domain/appeals/queries";
import { CATEGORY_LABEL_KEYS } from "@/domain/carc";
import { ACTION_STATUSES } from "@/domain/denial-status";
import { getFormat, getT } from "@/i18n/server";
import { audit } from "@/lib/audit";
import { formatCents } from "@/lib/format";
import { NewAppealForm } from "./NewAppealForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("appeals");
  return { title: t("new.title") };
}

export default async function NewAppealPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { denialId } = await searchParams;
  const parsed = z.uuid().safeParse(denialId);
  if (!parsed.success) notFound();
  const auth = await requireAuth();
  const t = await getT("appeals");
  const tc = await getT("common");
  const f = await getFormat();

  const data = await withTenant(auth, async (tx) => {
    const [row] = await tx
      .select({ denial: denials, claim: claims, payer: payers })
      .from(denials)
      .innerJoin(claims, eq(claims.id, denials.claimId))
      .innerJoin(payers, eq(payers.id, claims.payerId))
      .where(eq(denials.id, parsed.data));
    if (!row) return null;
    const openAppeals = await openAppealsForDenial(tx, parsed.data);
    await audit(tx, {
      action: "appeal.create_form_viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "denial",
      entityId: row.denial.id,
    });
    return { ...row, openAppeals };
  });
  if (!data) notFound();
  const { denial, claim, payer, openAppeals } = data;

  const canStart = canWorkAppeals(auth.role);
  const eligible = ACTION_STATUSES.includes(denial.status) && openAppeals.length === 0;
  const deadline = firstLevelDeadline({
    regime: payer.regime,
    noticeDate: denial.noticeDate,
    payerAppealWindowDays: payer.appealWindowDays,
  });

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-6">
      <nav aria-label={t("nav.breadcrumb")} className="text-label text-muted">
        <Link href={`/denials/${denial.id}`} className="font-medium text-link hover:underline">
          {claim.claimNumber}
        </Link>{" "}
        <span aria-hidden>/</span> {t("new.breadcrumb")}
      </nav>
      <PageHeader title={t("new.pageTitle")} description={t("new.description")} />

      {!canStart ? (
        <Panel>
          <p className="text-body text-muted">{t("error.notAllowedStart")}</p>
        </Panel>
      ) : !eligible ? (
        <Panel>
          <p className="text-body text-muted">
            {openAppeals.length > 0 ? t("error.alreadyOpen") : t("error.notEligible")}
          </p>
          <Link
            href={`/denials/${denial.id}`}
            className="mt-3 inline-block font-medium text-link hover:underline"
          >
            {t("new.backToDenial")}
          </Link>
        </Panel>
      ) : (
        <Panel title={t("new.panelTitle")}>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 pb-4">
            <div>
              <dt className="text-label font-medium text-muted">{tc("word.claim")}</dt>
              <dd className="font-mono text-body text-text">{claim.claimNumber}</dd>
            </div>
            <div>
              <dt className="text-label font-medium text-muted">{tc("word.payer")}</dt>
              <dd className="text-body text-text">{payer.name}</dd>
            </div>
            <div>
              <dt className="text-label font-medium text-muted">{t("new.denialCategory")}</dt>
              <dd className="text-body text-text">{tc(CATEGORY_LABEL_KEYS[denial.category])}</dd>
            </div>
            <div>
              <dt className="text-label font-medium text-muted">{t("field.deniedAmount")}</dt>
              <dd className="text-body text-text">{formatCents(denial.deniedCents)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-label font-medium text-muted">{tc("word.deadline")}</dt>
              <dd className="text-body text-text">
                {deadline ? (
                  <>
                    {t("new.deadlineLine", { date: f.date(deadline.date), citation: deadline.citation })}
                    {deadline.verify && (
                      <span className="ml-1 text-warning-fg">{t("new.pendingVerification")}</span>
                    )}
                  </>
                ) : (
                  <span className="text-warning-fg">{t("new.notConfigured", { payer: payer.name })}</span>
                )}
              </dd>
            </div>
          </dl>
          <NewAppealForm denialId={denial.id} />
        </Panel>
      )}
    </div>
  );
}
