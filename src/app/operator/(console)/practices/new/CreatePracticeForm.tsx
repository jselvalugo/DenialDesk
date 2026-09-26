"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { primaryLinkButtonClass } from "@/components/ui/linkButton";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import { createPractice, type CreateState } from "../../actions";

/** Remounting on "Create another" drops the action state, so the one-time password leaves the page. */
export function CreatePracticeForm() {
  const [round, setRound] = useState(0);
  return <CreatePracticeRound key={round} onAnother={() => setRound((r) => r + 1)} />;
}

function CreatePracticeRound({ onAnother }: { onAnother: () => void }) {
  const [state, action] = useActionState<CreateState, FormData>(createPractice, {});

  if (state.created) {
    const { tenantId, name, adminEmail, temporaryPassword } = state.created;
    return (
      <div className="flex flex-col gap-4">
        <div role="status" className="rounded-panel border border-success-border bg-success-bg p-4">
          <p className="text-body font-semibold text-success-fg">{name} created</p>
          <p className="mt-1 text-body text-text">
            Send the admin their sign-in details through a secure channel. This password is shown only once.
          </p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
            <dt className="text-muted">Email</dt>
            <dd className="font-mono">{adminEmail}</dd>
            <dt className="text-muted">Temporary password</dt>
            <dd className="font-mono">{temporaryPassword}</dd>
          </dl>
          <p className="mt-2 text-label text-muted">
            They&apos;ll set up two-step verification on first sign-in.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link href={`/operator/practices/${tenantId}`} className={primaryLinkButtonClass}>
            Open practice
          </Link>
          <Link href="/operator" className="text-body font-medium text-link hover:underline">
            All practices
          </Link>
          <Button variant="ghost" onClick={onAnother}>
            Create another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormAlert message={state.error} />
      <TextField label="Practice name" name="name" required maxLength={120} />
      <div className="grid grid-cols-2 gap-4">
        <TextField label="Admin's full name" name="adminName" required maxLength={120} />
        <TextField label="Admin's work email" name="adminEmail" type="email" required maxLength={254} />
      </div>
      <div className="flex items-center gap-4">
        <SubmitButton variant="primary" pendingLabel="Creating…">
          Create practice
        </SubmitButton>
        <Link href="/operator" className="text-body font-medium text-link hover:underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}
