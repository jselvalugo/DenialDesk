"use client";

import { useActionState } from "react";
import { confirmMfaEnrollment, verifyMfa, type FormState } from "@/auth/actions";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";

export function CodeForm({ mode }: { mode: "verify" | "enroll" }) {
  const [state, action] = useActionState<FormState, FormData>(
    mode === "enroll" ? confirmMfaEnrollment : verifyMfa,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormAlert message={state.error} />
      <TextField
        label="6-digit code"
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        autoFocus
        className="tabular font-mono tracking-[0.3em]"
      />
      <SubmitButton variant="primary" pendingLabel="Verifying…" className="h-9 w-full">
        {mode === "enroll" ? "Turn on two-step verification" : "Verify"}
      </SubmitButton>
    </form>
  );
}
