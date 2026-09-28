"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { StepUpLink } from "@/components/auth/StepUpLink";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { SelectField } from "@/components/ui/SelectField";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useT } from "@/i18n/client";
import {
  REVOKE_REASON_CODES,
  REVOKE_REASON_LABEL_KEYS,
  type ConnectionStatus,
} from "@/domain/integrations/connection-status";
import {
  activateSandboxAction,
  pauseConnectionAction,
  resumeConnectionAction,
  revokeConnectionAction,
  withdrawConnectionAction,
  type IntegrationFormState,
} from "./actions";

function ActionForm({
  action,
  connectionId,
  children,
}: {
  action: (state: IntegrationFormState, formData: FormData) => Promise<IntegrationFormState>;
  connectionId: string;
  children: (state: IntegrationFormState, pending: boolean) => React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState<IntegrationFormState, FormData>(action, {});
  return (
    <form action={formAction} className="inline-flex flex-col items-start gap-1.5">
      <input type="hidden" name="connectionId" value={connectionId} />
      {children(state, pending)}
    </form>
  );
}

function RevokeDialog({ connectionId }: { connectionId: string }) {
  const t = useT("settings");
  const tc = useT("common");
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const [state, action, pending] = useActionState<IntegrationFormState, FormData>(revokeConnectionAction, {});

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        {t("integrations.action.revoke")}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialog.current) setOpen(false);
        }}
        className="w-[min(480px,calc(100vw-2rem))] rounded-panel border border-border bg-surface p-0 text-text shadow-lg backdrop:bg-navy/40"
      >
        <form action={action} className="flex flex-col">
          <input type="hidden" name="connectionId" value={connectionId} />
          <div className="flex flex-col gap-3 p-5">
            <h2 id={titleId} className="text-heading font-semibold text-text">
              {t("integrations.revoke.confirmTitle")}
            </h2>
            <p className="text-body text-muted">{t("integrations.revoke.confirmDescription")}</p>
            <FormAlert message={state.error} />
            {state.stepUpRequired && (
              <p role="alert" className="text-label text-muted">
                <StepUpLink label={t("integrations.action.verifyIdentity")} />
              </p>
            )}
            <SelectField
              label={t("integrations.revoke.reasonLabel")}
              name="reasonCode"
              options={REVOKE_REASON_CODES.map((code) => ({
                value: code,
                label: t(REVOKE_REASON_LABEL_KEYS[code]),
              }))}
              error={state.field === "reasonCode" ? state.error : undefined}
            />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-muted px-5 py-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {tc("action.cancel")}
            </Button>
            <SubmitButton variant="danger" pendingLabel={tc("action.saving")} disabled={pending}>
              {t("integrations.revoke.confirm")}
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}

/**
 * Admin-only lifecycle actions on the connection record page (spec "PI1b"). Menu visibility is
 * not access control: every action re-checks the role and the transition on the server.
 */
export function ConnectionActions({
  connectionId,
  status,
  isSandbox,
  syntheticOnly,
}: {
  connectionId: string;
  status: ConnectionStatus;
  isSandbox: boolean;
  syntheticOnly: boolean;
}) {
  const t = useT("settings");

  if (status === "revoked") return null;

  return (
    <div className="flex flex-wrap items-start gap-2">
      {status === "draft" && (
        <Link
          href={`/settings/integrations/${connectionId}/edit`}
          className="inline-flex h-8 items-center rounded-control border border-border-strong bg-surface px-3 text-body font-medium text-text hover:bg-surface-muted"
        >
          {t("integrations.action.edit")}
        </Link>
      )}

      {status === "draft" && isSandbox && syntheticOnly && (
        <ActionForm action={activateSandboxAction} connectionId={connectionId}>
          {(state, pending) => (
            <>
              <SubmitButton
                variant="primary"
                pendingLabel={t("integrations.action.activateSandboxPending")}
                disabled={pending}
              >
                {t("integrations.action.activateSandbox")}
              </SubmitButton>
              {state.error && (
                <p role="alert" className="text-label font-medium text-danger-fg">
                  {state.error}
                </p>
              )}
              {state.stepUpRequired && (
                <p className="text-label">
                  <StepUpLink label={t("integrations.action.verifyIdentity")} />
                </p>
              )}
            </>
          )}
        </ActionForm>
      )}

      {status === "draft" && !isSandbox && (
        <div className="flex flex-col gap-1">
          <span
            title={t("integrations.action.submitDisabledHint")}
            className="inline-flex h-8 w-fit cursor-not-allowed items-center rounded-control border border-border-strong bg-surface-muted px-3 text-body font-medium text-subtle"
          >
            {t("integrations.action.submit")}
          </span>
          {/* A `title` attribute alone is not discoverable without a pointer (security/correctness
              review PR #81, item 20); the same text is always shown here too. */}
          <p className="text-label text-muted">{t("integrations.action.submitDisabledHint")}</p>
        </div>
      )}

      {status === "pending_approval" && (
        <ActionForm action={withdrawConnectionAction} connectionId={connectionId}>
          {(state, pending) => (
            <>
              <SubmitButton
                variant="secondary"
                pendingLabel={t("integrations.action.withdrawPending")}
                disabled={pending}
              >
                {t("integrations.action.withdraw")}
              </SubmitButton>
              {state.error && (
                <p role="alert" className="text-label font-medium text-danger-fg">
                  {state.error}
                </p>
              )}
            </>
          )}
        </ActionForm>
      )}

      {status === "active" && (
        <ActionForm action={pauseConnectionAction} connectionId={connectionId}>
          {(state, pending) => (
            <>
              <SubmitButton
                variant="secondary"
                pendingLabel={t("integrations.action.pausePending")}
                disabled={pending}
              >
                {t("integrations.action.pause")}
              </SubmitButton>
              {state.error && (
                <p role="alert" className="text-label font-medium text-danger-fg">
                  {state.error}
                </p>
              )}
            </>
          )}
        </ActionForm>
      )}

      {(status === "paused" || status === "error") && (
        <ActionForm action={resumeConnectionAction} connectionId={connectionId}>
          {(state, pending) => (
            <>
              <SubmitButton
                variant="primary"
                pendingLabel={t("integrations.action.resumePending")}
                disabled={pending}
              >
                {t("integrations.action.resume")}
              </SubmitButton>
              {state.error && (
                <p role="alert" className="text-label font-medium text-danger-fg">
                  {state.error}
                </p>
              )}
              {state.stepUpRequired && (
                <p className="text-label">
                  <StepUpLink label={t("integrations.action.verifyIdentity")} />
                </p>
              )}
            </>
          )}
        </ActionForm>
      )}

      <RevokeDialog connectionId={connectionId} />
    </div>
  );
}
