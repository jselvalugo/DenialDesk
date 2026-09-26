"use client";

import { useActionState, useEffect, useRef } from "react";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { addNote, assignDenial, changeStatus, type ActionState } from "./actions";

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
