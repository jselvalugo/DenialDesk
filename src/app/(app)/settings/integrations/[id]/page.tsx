import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { canManageIntegrations } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { hasRecentMfa } from "@/auth/step-up";
import { Field, FieldList } from "@/components/records/FieldList";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import {
  CONNECTION_STATUS_LABEL_KEYS,
  CONNECTION_STATUS_TONE,
  endpointEditable,
  getConnection,
  resolveSigningKid,
  submitBlockedReason,
} from "@/domain/integrations/connections";
import { getFormat, getT } from "@/i18n/server";
import { ConnectionForm } from "../ConnectionForm";
import { integrationActor } from "../form-state";
import { connectionTestDeps } from "../test-deps";
import { ConnectionLifecycleButton } from "./ConnectionLifecycle";
import { RevokeConnectionForm } from "./RevokeConnectionForm";
import { SubmitConnectionForm } from "./SubmitConnectionForm";
import { TestConnectionForm } from "./TestConnectionForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("integrations");
  return { title: t("detail.metaTitle") };
}

/**
 * One EHR/PM connection: its configuration, the edit form, and revoke with the offboarding steps
 * (docs/specs/patient-integrations.md PI1b-2; runbook docs/runbooks/integration-offboarding.md).
 * Administrators only: the base URL and client ID are Confidential configuration.
 */
export default async function ConnectionPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!canManageIntegrations(auth.role)) notFound();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const connection = await withTenant(auth, (tx) => getConnection(tx, id.data));
  if (!connection) notFound();
  const t = await getT("integrations");
  // Why Submit is unavailable right now, if it is (environment, another live connection, no passing
  // test in the last 24 h for this configuration and the live key): only a draft can be submitted.
  // Submit checks all of it again itself. The key is identified from public material only (`kid`).
  let submitBlocked: string | null = null;
  if (connection.status === "draft") {
    const signing = await resolveSigningKid(connectionTestDeps(), connection.id);
    const actor = integrationActor(auth);
    const reason = await withTenant(auth, (tx) => submitBlockedReason(tx, actor, connection, signing));
    submitBlocked = reason ? t(reason) : null;
  }
  const ts = await getT("settings");
  const format = await getFormat();
  const revoked = connection.status === "revoked";
  const updatedAt = connection.updatedAt.toISOString();

  const offboardingSteps = (withHeading: boolean) => (
    <div className="flex flex-col gap-2">
      {withHeading && <h3 className="text-body font-semibold text-text">{t("offboarding.title")}</h3>}
      <p className="text-body text-muted">{t("offboarding.description")}</p>
      <ol className="ml-5 list-decimal space-y-1 text-body text-text">
        <li>{t("offboarding.step1", { clientId: connection.clientId })}</li>
        <li>{t("offboarding.step2")}</li>
        <li>{t("offboarding.step3")}</li>
        <li>{t("offboarding.step4")}</li>
      </ol>
    </div>
  );
  const offboarding = !connection.isSandbox;
  // The lifecycle action each state offers (PI2a): pause a live connection, resume a stopped one
  // (a step-up is needed; from an error also a passing test), withdraw a submitted one. A draft has
  // none: it has the Submit panel.
  const lifecycle = (
    {
      active: { kind: "pause", description: "lifecycle.active" },
      paused: { kind: "resume", description: "lifecycle.paused" },
      error: { kind: "resume", description: "lifecycle.error" },
      pending_approval: { kind: "withdraw", description: "lifecycle.pending_approval" },
    } as const
  )[connection.status as "active" | "paused" | "error" | "pending_approval"];

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        label={ts("nav.breadcrumb")}
        items={[
          { label: ts("tabs.integrations"), href: "/settings/integrations" },
          { label: connection.displayName },
        ]}
      />

      <Panel title={t("detail.configurationTitle")} description={t("detail.configurationDescription")}>
        <FieldList columns={2}>
          <Field label={t("list.name")}>{connection.displayName}</Field>
          <Field label={t("detail.status")}>
            <Badge tone={CONNECTION_STATUS_TONE[connection.status]}>
              {t(CONNECTION_STATUS_LABEL_KEYS[connection.status])}
            </Badge>
          </Field>
          <Field label={t("detail.source")}>
            {connection.isSandbox ? t("source.sandbox") : t("source.fhir")}
          </Field>
          <Field label={t("detail.target")}>{t("target.patients")}</Field>
          <Field label={t("form.baseUrl")} mono span>
            {connection.baseUrl}
          </Field>
          <Field label={t("form.clientId")} mono>
            {connection.clientId}
          </Field>
          <Field label={t("form.mrnSystem")} mono>
            {connection.mrnIdentifierSystem}
          </Field>
          <Field
            label={t("detail.tokenEndpoint")}
            mono={Boolean(connection.tokenEndpoint)}
            empty={t("detail.notDiscovered")}
          >
            {connection.tokenEndpoint}
          </Field>
          <Field
            label={t("detail.issuer")}
            mono={Boolean(connection.issuer)}
            empty={t("detail.notDiscovered")}
          >
            {connection.issuer}
          </Field>
          <Field label={t("detail.created")} tabular>
            {format.dateTime(connection.createdAt)}
          </Field>
          <Field label={t("detail.lastSync")} tabular empty={t("list.never")}>
            {connection.lastSuccessAt ? format.dateTime(connection.lastSuccessAt) : null}
          </Field>
          {/* A withdrawn connection is a draft again: its old submission date would read as pending. */}
          {connection.submittedAt && connection.status !== "draft" && (
            <Field label={t("detail.submitted")} tabular>
              {format.dateTime(connection.submittedAt)}
            </Field>
          )}
          {connection.approvedAt && (
            <Field label={t("detail.approved")} tabular>
              {format.dateTime(connection.approvedAt)}
            </Field>
          )}
          {connection.revokedAt && (
            <Field label={t("detail.revokedAt")} tabular>
              {format.dateTime(connection.revokedAt)}
            </Field>
          )}
        </FieldList>
      </Panel>

      {revoked ? (
        offboarding && (
          <Panel title={t("offboarding.title")}>
            <div className="flex flex-col gap-4">
              <p className="text-body text-text">
                {t("offboarding.revokedNotice", { date: format.dateTime(connection.revokedAt!) })}
              </p>
              {offboardingSteps(false)}
            </div>
          </Panel>
        )
      ) : (
        <>
          {/* The built-in sandbox has no transport to test against until PI2b. */}
          {!connection.isSandbox && (
            <Panel title={t("test.title")} description={t("test.description")}>
              <TestConnectionForm id={connection.id} />
            </Panel>
          )}
          {connection.status === "draft" && (
            <Panel title={t("submit.title")}>
              <SubmitConnectionForm
                id={connection.id}
                updatedAt={updatedAt}
                sandbox={connection.isSandbox}
                blockedReason={submitBlocked}
                needsStepUp={!hasRecentMfa(auth.mfaVerifiedAt)}
              />
            </Panel>
          )}
          {connection.status === "pending_approval" && (
            <Panel title={t("submit.awaitingTitle")}>
              <p className="text-body text-text">{t("submit.awaitingDescription")}</p>
            </Panel>
          )}
          {lifecycle && (
            <Panel title={t("lifecycle.title")}>
              <div className="flex flex-col gap-4">
                <p className="text-body text-muted">{t(lifecycle.description)}</p>
                <ConnectionLifecycleButton kind={lifecycle.kind} id={connection.id} updatedAt={updatedAt} />
              </div>
            </Panel>
          )}
          <Panel flush>
            <ConnectionForm
              sandbox={connection.isSandbox}
              endpointLocked={!endpointEditable(connection)}
              connection={{
                id: connection.id,
                displayName: connection.displayName,
                baseUrl: connection.baseUrl,
                clientId: connection.clientId,
                mrnIdentifierSystem: connection.mrnIdentifierSystem,
                updatedAt,
              }}
            />
          </Panel>
          <Panel title={t("revoke.title")} description={t("revoke.description")}>
            <div className="flex flex-col gap-5">
              {offboarding && offboardingSteps(true)}
              <RevokeConnectionForm id={connection.id} updatedAt={updatedAt} />
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
