"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormActions, FormNotices, FormSection } from "@/components/records/FormShell";
import { FormAlert } from "@/components/ui/FormAlert";
import { linkButtonReset } from "@/components/ui/linkButton";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import { useT } from "@/i18n/client";
import { createConnectionAction, updateConnectionAction } from "./actions";
import type { ConnectionFormState } from "./form-state";

export interface ConnectionValues {
  id: string;
  displayName: string;
  baseUrl: string;
  clientId: string;
  mrnIdentifierSystem: string;
  updatedAt: string;
}

/**
 * Create or edit an EHR/PM connection (docs/specs/patient-integrations.md PI1b-2), rendered inside
 * `<Panel flush>`. `sandbox`: the built-in test sandbox, whose endpoint is fixed, so only the name is
 * asked for. `endpointLocked`: the endpoint inputs are shown disabled — the browser leaves them out
 * of the submission, and the server only changes the name.
 */
export function ConnectionForm({
  connection,
  sandbox,
  endpointLocked = false,
}: {
  connection?: ConnectionValues;
  sandbox: boolean;
  endpointLocked?: boolean;
}) {
  const t = useT("integrations");
  const tc = useT("common");
  const editing = Boolean(connection);
  const [state, action] = useActionState<ConnectionFormState, FormData>(
    editing ? updateConnectionAction : createConnectionAction,
    {},
  );
  const errorFor = (name: string) => (state.field === name ? state.error : undefined);

  return (
    <form action={action} className="flex flex-col" noValidate>
      {connection && (
        <>
          <input type="hidden" name="id" value={connection.id} />
          <input type="hidden" name="updatedAt" value={connection.updatedAt} />
        </>
      )}
      <FormNotices>
        <FormAlert message={state.field ? undefined : state.error} />
      </FormNotices>
      <FormSection
        title={editing ? t("detail.editTitle") : t("new.title")}
        description={editing ? t("detail.editDescription") : t("new.description")}
      >
        {!editing && sandbox && <p className="text-body text-muted">{t("new.sandboxNotice")}</p>}
        <TextField
          label={t("form.displayName")}
          name="displayName"
          defaultValue={connection?.displayName ?? ""}
          maxLength={80}
          required
          hint={t("form.displayNameHint")}
          error={errorFor("displayName")}
        />
        {!sandbox && (
          <>
            <TextField
              label={t("form.baseUrl")}
              name="baseUrl"
              type="url"
              inputMode="url"
              defaultValue={connection?.baseUrl ?? ""}
              maxLength={2048}
              required
              disabled={endpointLocked}
              className="font-mono"
              hint={t("form.baseUrlHint")}
              error={errorFor("baseUrl")}
            />
            <TextField
              label={t("form.clientId")}
              name="clientId"
              defaultValue={connection?.clientId ?? ""}
              maxLength={255}
              required
              disabled={endpointLocked}
              className="font-mono"
              hint={t("form.clientIdHint")}
              error={errorFor("clientId")}
            />
            <TextField
              label={t("form.mrnSystem")}
              name="mrnIdentifierSystem"
              defaultValue={connection?.mrnIdentifierSystem ?? ""}
              maxLength={255}
              required
              disabled={endpointLocked}
              className="font-mono"
              hint={t("form.mrnSystemHint")}
              error={errorFor("mrnIdentifierSystem")}
            />
            {endpointLocked && <p className="text-label text-muted">{t("form.endpointLockedHint")}</p>}
          </>
        )}
      </FormSection>
      <FormActions>
        <SubmitButton variant="primary" pendingLabel={editing ? t("form.saving") : t("new.creating")}>
          {editing ? t("form.save") : t("new.create")}
        </SubmitButton>
        <Link
          href={connection ? `/settings/integrations/${connection.id}` : "/settings/integrations"}
          className={linkButtonReset}
        >
          {tc("action.cancel")}
        </Link>
      </FormActions>
    </form>
  );
}
