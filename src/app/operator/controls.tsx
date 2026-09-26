"use client";

import { useActionState, useEffect, useRef } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import { createPractice, resetDemo, toggleSuspended, type ActionState, type CreateState } from "./actions";

export function CreatePracticeForm() {
  const [state, action] = useActionState<CreateState, FormData>(createPractice, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.created) formRef.current?.reset();
  }, [state]);

  return (
    <div className="flex flex-col gap-4">
      {state.created && (
        <div role="status" className="rounded-panel border border-success-border bg-success-bg p-4">
          <p className="text-body font-semibold text-success-fg">{state.created.name} created</p>
          <p className="mt-1 text-body text-text">
            Send the admin their sign-in details through a secure channel. This password is shown only once.
          </p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
            <dt className="text-muted">Email</dt>
            <dd className="font-mono">{state.created.adminEmail}</dd>
            <dt className="text-muted">Temporary password</dt>
            <dd className="font-mono">{state.created.temporaryPassword}</dd>
          </dl>
          <p className="mt-2 text-label text-muted">
            They&apos;ll set up two-step verification on first sign-in.
          </p>
        </div>
      )}
      <form ref={formRef} action={action} className="flex flex-col gap-4" noValidate>
        <FormAlert message={state.error} />
        <TextField label="Practice name" name="name" required maxLength={120} />
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Admin's full name" name="adminName" required maxLength={120} />
          <TextField label="Admin's work email" name="adminEmail" type="email" required maxLength={254} />
        </div>
        <div>
          <SubmitButton variant="primary" pendingLabel="Creating…">
            Create practice
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}

export function SuspendToggle({
  tenantId,
  suspended,
  name,
}: {
  tenantId: string;
  suspended: boolean;
  name: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(toggleSuspended, {});
  return (
    <form action={action} className="flex items-center justify-end gap-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="suspend" value={suspended ? "false" : "true"} />
      {state.error && (
        <span role="alert" className="text-label text-danger-fg">
          {state.error}
        </span>
      )}
      <SubmitButton
        size="sm"
        variant={suspended ? "secondary" : "danger"}
        pendingLabel="Saving…"
        aria-label={`${suspended ? "Reactivate" : "Suspend"} ${name}`}
      >
        {suspended ? "Reactivate" : "Suspend"}
      </SubmitButton>
    </form>
  );
}

export function ResetDemoButton() {
  const [, action] = useActionState<ActionState, FormData>(() => resetDemo(), {});
  return (
    <form action={action}>
      <SubmitButton pendingLabel="Resetting…">Reset demo practice</SubmitButton>
    </form>
  );
}
