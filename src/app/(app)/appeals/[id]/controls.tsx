"use client";

import { useActionState, useEffect, useRef } from "react";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  APPEAL_DECISION_OUTCOME_LABEL_KEYS,
  APPEAL_SUBMITTED_METHOD_LABEL_KEYS,
  type AppealDecisionOutcome,
  type AppealSubmittedMethod,
} from "@/domain/appeals/status";
import { useT } from "@/i18n/client";
import { addAppealNote, recordAppealDecision, recordAppealSubmission, type ActionState } from "./actions";

const fieldClass =
  "h-9 rounded-control border border-border-strong bg-surface px-2.5 text-body text-text focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus";

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
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-label font-medium text-muted">
          {t("field.method")}
          <select name="method" defaultValue="portal" disabled={disabled} className={fieldClass}>
            {(Object.keys(APPEAL_SUBMITTED_METHOD_LABEL_KEYS) as AppealSubmittedMethod[]).map((method) => (
              <option key={method} value={method}>
                {t(APPEAL_SUBMITTED_METHOD_LABEL_KEYS[method])}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-label font-medium text-muted">
          {t("field.submittedDate")}
          <input
            type="date"
            name="submittedOn"
            max={today}
            defaultValue={today}
            disabled={disabled}
            className={fieldClass}
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-label font-medium text-muted">
          {t("field.trackingReferenceOptional")}
          <input type="text" name="trackingReference" disabled={disabled} className={fieldClass} />
        </label>
      </div>
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
  const outcomeRef = useRef<HTMLSelectElement>(null);
  const t = useT("appeals");
  const tc = useT("common");
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="appealId" value={appealId} />
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-label font-medium text-muted">
          {t("field.outcome")}
          <select
            ref={outcomeRef}
            name="outcome"
            defaultValue="upheld"
            disabled={disabled}
            className={fieldClass}
          >
            {(Object.keys(APPEAL_DECISION_OUTCOME_LABEL_KEYS) as AppealDecisionOutcome[]).map((outcome) => (
              <option key={outcome} value={outcome}>
                {t(APPEAL_DECISION_OUTCOME_LABEL_KEYS[outcome])}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-label font-medium text-muted">
          {t("field.decisionDate")}
          <input
            type="date"
            name="decisionOn"
            min={minDate}
            max={today}
            defaultValue={today}
            disabled={disabled}
            className={fieldClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-label font-medium text-muted">
          {t("field.recoveredAmount")}
          <input
            type="text"
            inputMode="decimal"
            name="recoveredDollars"
            placeholder={t("field.recoveredPlaceholder", { amount: (deniedCents / 100).toFixed(2) })}
            disabled={disabled}
            className={fieldClass}
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-label font-medium text-muted">
          {t("field.closeReason")}
          <textarea
            name="closeReason"
            rows={2}
            disabled={disabled}
            className="rounded-control border border-border-strong bg-surface px-2.5 py-2 text-body text-text"
          />
        </label>
      </div>
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
