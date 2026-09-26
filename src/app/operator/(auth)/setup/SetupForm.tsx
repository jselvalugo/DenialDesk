"use client";

import { useActionState } from "react";
import type { FormState } from "@/auth/credentials";
import { setUpOperator } from "@/auth/operator-actions";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";

export function SetupForm() {
  const [state, action] = useActionState<FormState, FormData>(setUpOperator, {});
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormAlert message={state.error} />
      <TextField
        label="Operator email"
        name="email"
        type="email"
        autoComplete="username"
        required
        autoFocus
      />
      <TextField label="Setup code" name="code" type="password" autoComplete="off" required />
      <TextField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters. A passphrase works well."
        required
      />
      <TextField
        label="Confirm new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
      />
      <SubmitButton variant="primary" pendingLabel="Setting up…" className="h-9 w-full">
        Set up and continue
      </SubmitButton>
    </form>
  );
}
