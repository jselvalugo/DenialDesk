"use client";

import { startTransition, useActionState } from "react";
import { StepUpLink } from "@/components/auth/StepUpLink";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { useT } from "@/i18n/client";
import { submitConnectionAction } from "../actions";
import type { ConnectionFormState } from "../form-state";

/**
 * Submit (docs/specs/patient-integrations.md PI2a). A real connection carries the U.S.-residency
 * attestation (the checkbox holds the exact wording); the built-in sandbox is synthetic and has none.
 * The button is disabled, with the reason shown beside it, until a passing Test connection is on
 * record; the step-up link appears when the session's last MFA is too old, and again if the server
 * refuses for that reason (the window can close between page load and click). The server checks all
 * of it again: nothing here is access control.
 */
export function SubmitConnectionForm({
  id,
  updatedAt,
  sandbox,
  testPassed,
  needsStepUp,
}: {
  id: string;
  updatedAt: string;
  sandbox: boolean;
  testPassed: boolean;
  needsStepUp: boolean;
}) {
  const t = useT("integrations");
  const [state, action, pending] = useActionState<ConnectionFormState, FormData>(submitConnectionAction, {});
  const blocked = !testPassed;
  return (
    // noValidate: the translated refusal (checked on the server) shows instead of the browser's bubble.
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => action(formData));
      }}
      className="flex flex-col items-start gap-3"
      noValidate
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="updatedAt" value={updatedAt} />
      <p className="text-body text-muted">
        {sandbox ? t("submit.descriptionSandbox") : t("submit.descriptionReal")}
      </p>
      {blocked && (
        <p id="submit-blocked" role="note" className="text-body text-text">
          {sandbox ? t("submit.blocked.sandbox") : t("submit.blocked.noPassingTest")}
        </p>
      )}
      <FormAlert message={state.error} id="submit-error" />
      {(needsStepUp || state.stepUpRequired) && (
        <div className="flex flex-col items-start gap-1">
          <p className="text-body text-text">{t("submit.stepUpNotice")}</p>
          <StepUpLink label={t("stepUp.link")} />
        </div>
      )}
      {!sandbox && (
        <div className="flex flex-col gap-1">
          <label className="flex items-start gap-2 text-body text-text">
            <input
              type="checkbox"
              name="attest"
              // Only the missing attestation is this checkbox's error (not a stale page, say).
              aria-invalid={state.field === "attestation" ? true : undefined}
              aria-describedby={state.field === "attestation" ? "submit-error" : undefined}
              className="mt-1 size-4"
            />
            <span>{t("submit.attestation")}</span>
          </label>
          <p className="ml-6 text-label text-muted">{t("submit.attestationHint")}</p>
        </div>
      )}
      <Button
        type="submit"
        disabled={pending || blocked}
        aria-disabled={pending || blocked}
        aria-describedby={blocked ? "submit-blocked" : undefined}
      >
        {pending ? t("submit.pending") : sandbox ? t("submit.submitSandbox") : t("submit.submit")}
      </Button>
    </form>
  );
}
