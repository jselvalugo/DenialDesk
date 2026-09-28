"use client";

import { useActionState, useEffect, useRef } from "react";
import { FormRow } from "@/components/records/FormShell";
import { SelectField } from "@/components/ui/SelectField";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextareaField } from "@/components/ui/TextareaField";
import { TextField } from "@/components/ui/TextField";
import {
  APPEAL_DECISION_OUTCOME_LABEL_KEYS,
  APPEAL_SUBMITTED_METHOD_LABEL_KEYS,
  type AppealDecisionOutcome,
  type AppealSubmittedMethod,
} from "@/domain/appeals/status";
import { useT } from "@/i18n/client";
import { addAppealNote, recordAppealDecision, recordAppealSubmission, type ActionState } from "./actions";

function InlineError({ state }: { state: ActionState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="text-label font-medium text-danger-fg">
      {state.error}
    </p>
  );
}

export function SubmissionForm({
  appealId,
  today,
  disabled,
}: {
  appealId: string;
  today: string;
  disabled: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(recordAppealSubmission, {});
  const t = useT("appeals");
  const tc = useT("common");
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="appealId" value={appealId} />
      <FormRow columns="grid-cols-2">
        <SelectField
          label={t("field.method")}
          name="method"
          defaultValue="portal"
          disabled={disabled}
          options={(Object.keys(APPEAL_SUBMITTED_METHOD_LABEL_KEYS) as AppealSubmittedMethod[]).map(
            (method) => ({ value: method, label: t(APPEAL_SUBMITTED_METHOD_LABEL_KEYS[method]) }),
          )}
        />
        <TextField
          label={t("field.submittedDate")}
          name="submittedOn"
          type="date"
          max={today}
          defaultValue={today}
          disabled={disabled}
        />
        <div className="col-span-2">
          <TextField
            label={t("field.trackingReferenceOptional")}
            name="trackingReference"
            disabled={disabled}
          />
        </div>
      </FormRow>
      <InlineError state={state} />
      <div>
        <SubmitButton variant="primary" pendingLabel={tc("action.saving")} disabled={disabled}>
          {t("panel.recordSubmission")}
        </SubmitButton>
      </div>
    </form>
  );
}

export function DecisionForm({
  appealId,
  today,
  minDate,
  deniedCents,
  disabled,
}: {
  appealId: string;
  today: string;
  minDate: string;
  deniedCents: number;
  disabled: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(recordAppealDecision, {});
  const t = useT("appeals");
  const tc = useT("common");
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="appealId" value={appealId} />
      <FormRow columns="grid-cols-2">
        <SelectField
          label={t("field.outcome")}
          name="outcome"
          defaultValue="upheld"
          disabled={disabled}
          options={(Object.keys(APPEAL_DECISION_OUTCOME_LABEL_KEYS) as AppealDecisionOutcome[]).map(
            (outcome) => ({ value: outcome, label: t(APPEAL_DECISION_OUTCOME_LABEL_KEYS[outcome]) }),
          )}
        />
        <TextField
          label={t("field.decisionDate")}
          name="decisionOn"
          type="date"
          min={minDate}
          max={today}
          defaultValue={today}
          disabled={disabled}
        />
        <TextField
          label={t("field.recoveredAmount")}
          name="recoveredDollars"
          inputMode="decimal"
          placeholder={t("field.recoveredPlaceholder", { amount: (deniedCents / 100).toFixed(2) })}
          disabled={disabled}
        />
        <div className="col-span-2">
          <TextareaField label={t("field.closeReason")} name="closeReason" rows={2} disabled={disabled} />
        </div>
      </FormRow>
      <InlineError state={state} />
      <div>
        <SubmitButton variant="primary" pendingLabel={tc("action.saving")} disabled={disabled}>
          {t("panel.recordDecision")}
        </SubmitButton>
      </div>
    </form>
  );
}

export function AppealNoteForm({ appealId, disabled }: { appealId: string; disabled: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(addAppealNote, {});
  const formRef = useRef<HTMLFormElement>(null);
  const t = useT("appeals");
  const tc = useT("common");
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2">
      <input type="hidden" name="appealId" value={appealId} />
      <label htmlFor="appeal-note-body" className="text-label font-medium text-text">
        {t("field.addNote")}
      </label>
      <textarea
        id="appeal-note-body"
        name="body"
        rows={3}
        maxLength={4000}
        disabled={disabled}
        placeholder={t("note.placeholder")}
        className="rounded-control border border-border-strong bg-surface px-3 py-2 text-body text-text placeholder:text-subtle focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus"
      />
      <InlineError state={state} />
      <div>
        <SubmitButton pendingLabel={tc("action.saving")} disabled={disabled}>
          {t("action.saveNote")}
        </SubmitButton>
      </div>
    </form>
  );
}
