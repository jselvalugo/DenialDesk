"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { FormActions, FormNotices, FormRow, FormSection } from "@/components/records/FormShell";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { linkButtonReset } from "@/components/ui/linkButton";
import { TextField } from "@/components/ui/TextField";
import { StepUpLink } from "@/components/auth/StepUpLink";
import { useT } from "@/i18n/client";
import { SANDBOX_BASE_URL, SANDBOX_CLIENT_ID } from "@/integrations/fhir/url-rules";
import { createConnectionAction, updateConnectionAction, type IntegrationFormState } from "./actions";

export interface ConnectionFormValues {
  id: string;
  displayName: string;
  baseUrl: string;
  clientId: string;
  mrnIdentifierSystem: string;
  isSandbox: boolean;
  usResidencyAttested: boolean;
}

/**
 * Create (own page, DESIGN.md §8) or edit a draft connection. The zod allow-list on the server
 * accepts exactly `displayName`, `baseUrl`, `clientId`, `mrnIdentifierSystem`, and
 * `usResidencyAttested`; a real endpoint's sandbox/real identity is decided from the submitted
 * `baseUrl`/`clientId` themselves (spec "PI1b"), not a separate hidden field.
 */
export function ConnectionForm({
  connection,
  syntheticOnly,
}: {
  connection?: ConnectionFormValues;
  syntheticOnly: boolean;
}) {
  const editing = Boolean(connection);
  const t = useT("settings");
  const tc = useT("common");
  const [state, action, pending] = useActionState<IntegrationFormState, FormData>(
    editing ? updateConnectionAction : createConnectionAction,
    {},
  );
  const err = (field: string) => (state.field === field ? state.error : undefined);

  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? "");
  const [clientId, setClientId] = useState(connection?.clientId ?? "");
  // A sandbox connection's endpoint is pinned; once created it can only be edited as the sandbox.
  const endpointLocked = editing && connection!.isSandbox;

  const fillSandbox = () => {
    setBaseUrl(SANDBOX_BASE_URL);
    setClientId(SANDBOX_CLIENT_ID);
  };

  return (
    <form
      action={action}
      className="flex flex-col"
      aria-label={t(editing ? "integrations.action.edit" : "integrations.new.title")}
    >
      {editing && <input type="hidden" name="connectionId" value={connection!.id} />}
      <FormNotices>
        <FormAlert message={state.error} />
        {state.stepUpRequired && (
          <p role="alert" className="text-label text-muted">
            <StepUpLink label={t("integrations.action.verifyIdentity")} />
          </p>
        )}
      </FormNotices>

      <FormSection title={t("integrations.section.configuration")}>
        <FormRow columns="md:grid-cols-1">
          <TextField
            label={t("integrations.form.displayName")}
            name="displayName"
            required
            maxLength={80}
            hint={t("integrations.form.displayNameHint")}
            defaultValue={connection?.displayName}
            error={err("displayName")}
          />
        </FormRow>

        {!editing && syntheticOnly && (
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={fillSandbox}>
              {t("integrations.new.sandboxOption")}
            </Button>
            <p className="mt-1.5 text-label text-muted">{t("integrations.new.sandboxHint")}</p>
          </div>
        )}

        <FormRow columns="md:grid-cols-2">
          <TextField
            label={t("integrations.form.baseUrl")}
            name="baseUrl"
            required
            maxLength={2048}
            hint={endpointLocked ? t("integrations.form.endpointLocked") : t("integrations.form.baseUrlHint")}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            readOnly={endpointLocked}
            className={endpointLocked ? "bg-surface-muted text-muted" : undefined}
            error={err("baseUrl")}
          />
          <TextField
            label={t("integrations.form.clientId")}
            name="clientId"
            required
            maxLength={255}
            hint={
              endpointLocked ? t("integrations.form.endpointLocked") : t("integrations.form.clientIdHint")
            }
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            readOnly={endpointLocked}
            className={endpointLocked ? "bg-surface-muted text-muted" : undefined}
            error={err("clientId")}
          />
        </FormRow>

        <FormRow columns="md:grid-cols-1">
          <TextField
            label={t("integrations.form.mrnIdentifierSystem")}
            name="mrnIdentifierSystem"
            required
            maxLength={255}
            hint={t("integrations.form.mrnIdentifierSystemHint")}
            defaultValue={connection?.mrnIdentifierSystem}
            error={err("mrnIdentifierSystem")}
          />
        </FormRow>

        <label className="flex items-start gap-2 text-body text-text">
          <input
            type="checkbox"
            name="usResidencyAttested"
            defaultChecked={connection?.usResidencyAttested}
            aria-invalid={state.field === "usResidencyAttested" || undefined}
            className="mt-0.5 size-4 accent-primary"
          />
          {t("integrations.form.usResidencyAttested")}
        </label>
      </FormSection>

      <FormActions>
        <Button type="submit" variant="primary" disabled={pending} aria-disabled={pending}>
          {pending ? t("integrations.new.saving") : editing ? tc("action.save") : t("integrations.new.save")}
        </Button>
        <Link
          href={editing ? `/settings/integrations/${connection!.id}` : "/settings/integrations"}
          className={linkButtonReset}
        >
          {tc("action.cancel")}
        </Link>
      </FormActions>
    </form>
  );
}
