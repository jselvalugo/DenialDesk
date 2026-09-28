import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { requireOperator } from "@/auth/operator";
import { Field, FieldList } from "@/components/records/FieldList";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { getPendingApproval } from "@/domain/integrations/approval";
import { getFormat, getT } from "@/i18n/server";
import { ApproveConnectionForm } from "./ApproveConnectionForm";
import { RejectConnectionForm } from "./RejectConnectionForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("operator");
  return { title: t("integrations.reviewMetaTitle") };
}

const keyModeLabels = {
  per_connection: "integrations.keyMode.per_connection",
  shared_vendor_exception: "integrations.keyMode.shared_vendor_exception",
  preprod_shared: "integrations.keyMode.preprod_shared",
} as const;

/**
 * The operator's review of one submitted EHR/PM connection (docs/specs/patient-integrations.md
 * PI1c): the configuration exactly as the practice submitted it (configuration only, no PHI), then
 * Approve (with how it was verified) or Reject (with a reason code).
 */
export default async function ReviewConnectionPage({
  params,
}: {
  params: Promise<{ tenantId: string; connectionId: string }>;
}) {
  const ids = z.object({ tenantId: z.uuid(), connectionId: z.uuid() }).safeParse(await params);
  if (!ids.success) notFound();
  const operator = await requireOperator();
  const t = await getT("operator");
  const tc = await getT("common");
  const f = await getFormat();
  const item = await getPendingApproval(ids.data.tenantId, ids.data.connectionId, operator);

  const back = (
    <Link href="/operator/integrations" className="text-body font-medium text-link hover:underline">
      {t("integrations.title")}
    </Link>
  );
  if (!item) {
    // Decided by someone else meanwhile, withdrawn by the practice, or never this practice's: say so
    // rather than a bare 404 (the operator may have reloaded a page they just used).
    return (
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
        <PageHeader title={t("integrations.reviewTitle")} actions={back} />
        <Panel>
          <p className="text-body text-text">{t("errors.integrationNotPending")}</p>
        </Panel>
      </div>
    );
  }

  const keyModeKey =
    item.keyMode && item.keyMode in keyModeLabels
      ? keyModeLabels[item.keyMode as keyof typeof keyModeLabels]
      : null;
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <PageHeader
        title={t("integrations.reviewTitle")}
        description={t("integrations.reviewDescription", { practice: item.practiceName })}
        actions={back}
      />

      <Panel title={t("integrations.config.title")} description={t("integrations.config.description")}>
        <FieldList columns={2}>
          <Field label={t("integrations.field.name")}>{item.displayName}</Field>
          <Field label={t("integrations.field.submitted")} tabular>
            {item.submittedAt ? f.dateTime(item.submittedAt) : null}
          </Field>
          <Field label={t("integrations.field.baseUrl")} mono span>
            {item.baseUrl}
          </Field>
          <Field
            label={t("integrations.field.tokenEndpoint")}
            mono={Boolean(item.tokenEndpoint)}
            empty={t("integrations.field.notDiscovered")}
          >
            {item.tokenEndpoint}
          </Field>
          <Field
            label={t("integrations.field.issuer")}
            mono={Boolean(item.issuer)}
            empty={t("integrations.field.notDiscovered")}
          >
            {item.issuer}
          </Field>
          <Field label={t("integrations.field.clientId")} mono>
            {item.clientId}
          </Field>
          <Field label={t("integrations.field.mrnSystem")} mono>
            {item.mrnIdentifierSystem}
          </Field>
          <Field label={t("integrations.field.jwks")} mono>
            {item.jwksPath}
            <span className="mt-0.5 block font-sans text-label text-muted">
              {t("integrations.field.jwksHint")}
            </span>
          </Field>
          <Field label={t("integrations.field.keyMode")}>
            {t(keyModeKey ?? "integrations.keyMode.unassigned")}
          </Field>
          <Field label={t("integrations.field.scope")}>{t("integrations.scope.unset")}</Field>
          <Field label={t("integrations.field.attested")} tabular empty={tc("word.notSet")}>
            {item.attestedAt ? f.dateTime(item.attestedAt) : null}
          </Field>
        </FieldList>
      </Panel>

      <Panel title={t("integrations.approve.title")} description={t("integrations.approve.description")}>
        <ApproveConnectionForm
          tenantId={item.practiceId}
          connectionId={item.connectionId}
          updatedAt={item.updatedAt}
          clientId={item.clientId}
          today={todayIn()}
        />
      </Panel>

      <Panel title={t("integrations.reject.title")} description={t("integrations.reject.description")}>
        <RejectConnectionForm
          tenantId={item.practiceId}
          connectionId={item.connectionId}
          updatedAt={item.updatedAt}
        />
      </Panel>
    </div>
  );
}
