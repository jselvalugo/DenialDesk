"use client";

import { useActionState } from "react";
import { setNewPassword, type FormState } from "@/auth/actions";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";

export function PasswordForm() {
  const [state, action] = useActionState<FormState, FormData>(setNewPassword, {});
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormAlert message={state.error} />
      <TextField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters. A short phrase is easier to remember than symbols."
        required
        autoFocus
      />
      <TextField
        label="Confirm new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
      />
      <SubmitButton variant="primary" pendingLabel="Saving…" className="h-9 w-full">
        Set password
      </SubmitButton>
    </form>
  );
}
