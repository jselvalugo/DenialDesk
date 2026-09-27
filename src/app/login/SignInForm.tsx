"use client";

import { useActionState } from "react";
import { signIn, type FormState } from "@/auth/actions";
import { useT } from "@/i18n/client";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";

type SignInAction = (state: FormState, formData: FormData) => Promise<FormState>;

/** Practice sign-in by default; the operator console passes its own server action. */
export function SignInForm({ notice, submit }: { notice?: string; submit?: SignInAction }) {
  const [state, action] = useActionState<FormState, FormData>(submit ?? signIn, {});
  const t = useT("auth");
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormAlert message={state.error} />
      {!state.error && notice && (
        <p
          role="status"
          className="rounded-control border border-info-border bg-info-bg px-3 py-2 text-body text-info-fg"
        >
          {notice}
        </p>
      )}
      <TextField
        label={t("signIn.emailLabel")}
        name="email"
        type="email"
        autoComplete="username"
        required
        autoFocus
      />
      <TextField
        label={t("signIn.passwordLabel")}
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <SubmitButton variant="primary" pendingLabel={t("signIn.submitting")} className="h-9 w-full">
        {t("signIn.submit")}
      </SubmitButton>
    </form>
  );
}
