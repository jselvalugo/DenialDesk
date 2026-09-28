import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { canManageIntegrations } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Field, FieldList } from "@/components/records/FieldList";
import { RecordHeader } from "@/components/records/RecordHeader";
import { RecordLayout } from "@/components/records/RecordLayout";
import { Panel } from "@/components/ui/Panel";
import { secondaryLinkButtonClass } from "@/components/ui/linkButton";
import Link from "next/link";
import { withTenant } from "@/db/tenant";
import {
  connectionStatusLabel,
  connectionStatusTone,
  getConnection,
} from "@/domain/integrations/connections";
import { getFormat, getT } from "@/i18n/server";
import { syntheticDataOnly } from "@/lib/env";
import { ConnectionActions } from "../ConnectionActions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("integrations.detailMetaTitle") };
}

export default async function ConnectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();
  const t = await getT("settings");
  const tc = await getT("common");
  const f = await getFormat();
  const canManage = canManageIntegrations(auth.role);

  const connection = await withTenant(auth, (tx) => getConnection(tx, id));
  if (!connection) notFound();

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <Breadcrumbs
        label={t("nav.breadcrumb")}
        items={[
          { label: t("integrations.breadcrumbList"), href: "/settings/integrations" },
          { label: connection.displayName },
        ]}
      />

      <RecordHeader
        eyebrow={t("integrations.detailEyebrow")}
        title={connection.displayName}
        badges={
          <Badge tone={connectionStatusTone(connection.status)}>
            {connectionStatusLabel(connection.status, t)}
          </Badge>
        }
        meta={[
          { label: t("integrations.field.table"), value: t("integrations.table.patients") },
          { label: t("integrations.field.kind"), value: t("integrations.field.kindFhir") },
          {
            label: t("integrations.field.isSandbox"),
            value: connection.isSandbox
              ? t("integrations.field.isSandboxValue")
              : t("integrations.field.isRealValue"),
          },
        ]}
        actions={
          canManage ? (
            <ConnectionActions
              connectionId={connection.id}
              status={connection.status}
              isSandbox={connection.isSandbox}
              syntheticOnly={syntheticDataOnly()}
            />
          ) : undefined
        }
      />

      {/* Configuration and lifecycle detail are admin-only (security review PR #81, item 9): a
          non-admin's accessible name and drop-down already show the current state (that's not
          access control, spec "Menu visibility is not access control"), but the base URL, client
          ID, MRN identifier system, and attestation/approval history are not shown to a role that
          can't act on any of it. */}
      {canManage && connection.status === "revoked" && (
        <Panel title={t("integrations.revoke.offboardingTitle")}>
          <p className="text-body text-text">{t("integrations.revoke.offboardingBody")}</p>
          {connection.statusReason === "security_concern" && (
            <p className="mt-2 text-body text-text">
              {t("integrations.revoke.offboardingSecurityConcernNote")}
            </p>
          )}
          {connection.statusReason === "switching_systems" && (
            <p className="mt-2 text-body text-text">
              {t("integrations.revoke.offboardingSwitchingSystemsNote")}
            </p>
          )}
          {/* No in-app docs route exists yet; the full offboarding steps live in the repo runbook
              (docs/runbooks/integration-offboarding.md), cited by name for an admin who has repo
              access, same pattern as other operational runbooks (docs/PROJECT_STATE.md). */}
          <p className="mt-2 text-label text-muted">{t("integrations.revoke.offboardingRunbookNote")}</p>
        </Panel>
      )}

      {canManage && (
        <RecordLayout
          aside={
            <Panel title={t("integrations.section.lifecycle")}>
              <FieldList>
                <Field label={t("integrations.field.created")} tabular>
                  {f.dateTime(connection.createdAt)}
                </Field>
                <Field
                  label={t("integrations.field.attestation")}
                  empty={t("integrations.field.notAttested")}
                >
                  {connection.usResidencyAttestedAt
                    ? t("integrations.field.attestedBy", {
                        date: f.dateTime(connection.usResidencyAttestedAt),
                      })
                    : null}
                </Field>
                <Field label={t("integrations.field.submitted")} empty={tc("word.notSet")} tabular>
                  {connection.submittedAt ? f.dateTime(connection.submittedAt) : null}
                </Field>
                <Field label={t("integrations.field.approved")} empty={tc("word.notSet")} tabular>
                  {connection.approvedAt ? f.dateTime(connection.approvedAt) : null}
                </Field>
                <Field
                  label={t("integrations.field.lastSuccess")}
                  empty={t("integrations.neverSynced")}
                  tabular
                >
                  {connection.lastSuccessAt ? f.dateTime(connection.lastSuccessAt) : null}
                </Field>
                <Field label={t("integrations.field.revoked")} empty={tc("word.notSet")} tabular>
                  {connection.revokedAt ? f.dateTime(connection.revokedAt) : null}
                </Field>
              </FieldList>
            </Panel>
          }
        >
          <Panel title={t("integrations.section.configuration")}>
            <FieldList>
              <Field label={t("integrations.form.baseUrl")} mono>
                {connection.baseUrl}
              </Field>
              <Field label={t("integrations.form.clientId")} mono>
                {connection.clientId}
              </Field>
              <Field label={t("integrations.form.mrnIdentifierSystem")} mono>
                {connection.mrnIdentifierSystem}
              </Field>
            </FieldList>
          </Panel>

          <Panel title={t("integrations.action.syncHistory")}>
            <Link href={`/settings/integrations/${connection.id}/runs`} className={secondaryLinkButtonClass}>
              {t("integrations.action.syncHistory")}
            </Link>
          </Panel>
        </RecordLayout>
      )}
    </div>
  );
}
