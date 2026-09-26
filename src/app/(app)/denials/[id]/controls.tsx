"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { addNote, assignDenial, changeStatus, revealMemberId, type ActionState } from "./actions";

const fieldClass =
  "h-8 rounded-control border border-border-strong bg-surface pr-8 pl-2.5 text-body text-text focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus";

function InlineError({ state }: { state: ActionState }) {
  if (!state.error) return null;
  return (
    <p role="alert" className="text-label font-medium text-danger-fg">
      {state.error}
    </p>
  );
}

export function StatusControl({
  denialId,
  current,
  options,
  disabled,
}: {
  denialId: string;
  current: string;
  options: Array<{ value: string; label: string }>;
  disabled: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(changeStatus, {});
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="denialId" value={denialId} />
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-label font-medium text-muted">
          Status
          <select name="status" defaultValue={current} disabled={disabled} className={fieldClass}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton variant="primary" pendingLabel="Saving…" disabled={disabled}>
          Update status
        </SubmitButton>
      </div>
      <InlineError state={state} />
    </form>
  );
}

export function AssignControl({
  denialId,
  current,
  team,
  disabled,
}: {
  denialId: string;
  current: string | null;
  team: Array<{ id: string; displayName: string }>;
  disabled: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(assignDenial, {});
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="denialId" value={denialId} />
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-label font-medium text-muted">
          Assignee
          <select name="assigneeId" defaultValue={current ?? ""} disabled={disabled} className={fieldClass}>
            <option value="">Unassigned</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton pendingLabel="Saving…" disabled={disabled}>
          Assign
        </SubmitButton>
      </div>
      <InlineError state={state} />
    </form>
  );
}

export function NoteForm({ denialId, disabled }: { denialId: string; disabled: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(addNote, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2">
      <input type="hidden" name="denialId" value={denialId} />
      <label htmlFor="note-body" className="text-label font-medium text-text">
        Add a note
      </label>
      <textarea
        id="note-body"
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

/** Member ID masked by default; revealing it requires a reason and is audited (DESIGN.md §9). */
export function MaskedMemberId({ denialId, last4 }: { denialId: string; last4: string }) {
  const [value, setValue] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (value) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="font-mono text-body text-text">{value}</span>
        <Button size="sm" variant="ghost" onClick={() => setValue(null)}>
          Hide
        </Button>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-mono text-body text-text" aria-label={`Member ID ending in ${last4}`}>
        •••• {last4}
      </span>
      {choosing ? (
        <form
          className="inline-flex items-center gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const reason = String(new FormData(event.currentTarget).get("reason"));
            const result = await revealMemberId(denialId, reason);
            if (result.value) {
              setValue(result.value);
              setChoosing(false);
            } else setError(result.error ?? "Couldn't reveal.");
          }}
        >
          <label className="sr-only" htmlFor="reveal-reason">
            Reason for viewing
          </label>
          <select id="reveal-reason" name="reason" className={fieldClass} defaultValue="appeal">
            <option value="appeal">Preparing appeal</option>
            <option value="eligibility">Checking eligibility</option>
            <option value="payer_call">Payer phone call</option>
            <option value="other">Other</option>
          </select>
          <Button size="sm" type="submit">
            Reveal
          </Button>
        </form>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setChoosing(true)}>
          Reveal
        </Button>
      )}
      {error && <span className="text-label text-danger-fg">{error}</span>}
    </span>
  );
}
