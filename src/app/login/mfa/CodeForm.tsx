"use client";

import { useActionState } from "react";
import { confirmMfaEnrollment, verifyMfa, type FormState } from "@/auth/actions";
import { useT } from "@/i18n/client";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";

type CodeAction = (state: FormState, formData: FormData) => Promise<FormState>;

/**
 * Practice sign-in by default; the operator console and step-up re-verification
 * (src/app/(app)/step-up) pass their own server action, the latter with extra hidden fields
 * (`returnTo`) carried through to that action's FormData.
 */
export function CodeForm({
  mode,
  submit,
  hidden,
}: {
  mode: "verify" | "enroll";
  submit?: CodeAction;
  hidden?: Record<string, string>;
}) {
  const [state, action] = useActionState<FormState, FormData>(
    submit ?? (mode === "enroll" ? confirmMfaEnrollment : verifyMfa),
    {},
  );
  const t = useT("auth");
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {hidden &&
        Object.entries(hidden).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      <FormAlert message={state.error} />
      <TextField
        label={t("mfa.codeLabel")}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        required
        autoFocus
        className="tabular font-mono tracking-[0.3em]"
      />
      <SubmitButton variant="primary" pendingLabel={t("mfa.verifying")} className="h-9 w-full">
        {mode === "enroll" ? t("mfa.enrollSubmit") : t("mfa.verifySubmit")}
      </SubmitButton>
    </form>
  );
}
