"use client";

import { useActionState, useEffect, useRef } from "react";
import { SubmitButton } from "@/components/ui/SubmitButton";
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
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="appealId" value={appealId} />
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-label font-medium text-muted">
          Method
          <select name="method" defaultValue="portal" disabled={disabled} className={fieldClass}>
            <option value="portal">Payer portal</option>
            <option value="fax">Fax</option>
            <option value="mail">Mail</option>
            <option value="electronic">Electronic (clearinghouse)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-label font-medium text-muted">
          Submitted date
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
          Tracking / reference number (optional)
          <input type="text" name="trackingReference" disabled={disabled} className={fieldClass} />
        </label>
      </div>
      <InlineError state={state} />
      <div>
        <SubmitButton variant="primary" pendingLabel="Saving…" disabled={disabled}>
          Record submission
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
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="appealId" value={appealId} />
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-label font-medium text-muted">
          Outcome
          <select
            ref={outcomeRef}
            name="outcome"
            defaultValue="upheld"
            disabled={disabled}
            className={fieldClass}
          >
            <option value="overturned_full">Overturned in full</option>
            <option value="overturned_partial">Partially overturned</option>
            <option value="upheld">Upheld</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="dismissed">Dismissed</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-label font-medium text-muted">
          Decision date
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
          Recovered amount ($, overturned only)
          <input
            type="number"
            name="recoveredCents"
            step="0.01"
            min={0}
            max={deniedCents / 100}
            disabled={disabled}
            className={fieldClass}
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-label font-medium text-muted">
          Reason (required to withdraw or dismiss)
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
        <SubmitButton variant="primary" pendingLabel="Saving…" disabled={disabled}>
          Record decision
        </SubmitButton>
      </div>
    </form>
  );
}

export function AppealNoteForm({ appealId, disabled }: { appealId: string; disabled: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(addAppealNote, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2">
      <input type="hidden" name="appealId" value={appealId} />
      <label htmlFor="appeal-note-body" className="text-label font-medium text-text">
        Add a note
      </label>
      <textarea
        id="appeal-note-body"
        name="body"
        rows={3}
        maxLength={4000}
        disabled={disabled}
        placeholder="What you did, what's next, who you spoke with."
        className="rounded-control border border-border-strong bg-surface px-3 py-2 text-body text-text placeholder:text-subtle focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus"
      />
      <InlineError state={state} />
      <div>
        <SubmitButton pendingLabel="Saving…" disabled={disabled}>
          Save note
        </SubmitButton>
      </div>
    </form>
  );
}
