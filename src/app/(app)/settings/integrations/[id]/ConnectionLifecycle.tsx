"use client";

import { useActionState } from "react";
import { StepUpLink } from "@/components/auth/StepUpLink";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useT } from "@/i18n/client";
import { pauseConnectionAction, resumeConnectionAction, withdrawConnectionAction } from "../actions";
import type { ConnectionFormState } from "../form-state";

type Kind = "pause" | "resume" | "withdraw";
const ACTIONS = {
  pause: pauseConnectionAction,
  resume: resumeConnectionAction,
  withdraw: withdrawConnectionAction,
} as const;

/**
 * One lifecycle button (pause, resume, or withdraw) for the connection page. The refusal shows
 * above it; when a fresh MFA verification is what's missing (resume, R-7.2.2) it comes with the
 * link that does it and returns here.
 */
export function ConnectionLifecycleButton({
  kind,
  id,
  updatedAt,
}: {
  kind: Kind;
  id: string;
  updatedAt: string;
}) {
  const t = useT("integrations");
  const [state, action] = useActionState<ConnectionFormState, FormData>(ACTIONS[kind], {});
  return (
    <form action={action} className="flex flex-col items-start gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="updatedAt" value={updatedAt} />
      <FormAlert message={state.error} id={`${kind}-error`} />
      {state.stepUpRequired && <StepUpLink label={t("stepUp.link")} />}
      <SubmitButton variant="secondary" pendingLabel={t(`${kind}.pending`)}>
        {t(`${kind}.submit`)}
      </SubmitButton>
    </form>
  );
}
