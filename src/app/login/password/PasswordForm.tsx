"use client";

import { useActionState } from "react";
import { setNewPassword, type FormState } from "@/auth/actions";
import { useT } from "@/i18n/client";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";

export function PasswordForm() {
  const [state, action] = useActionState<FormState, FormData>(setNewPassword, {});
  const t = useT("auth");
  const tc = useT("common");
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <FormAlert message={state.error} />
      <TextField
        label={t("password.newLabel")}
        name="password"
        type="password"
        autoComplete="new-password"
        hint={t("password.hint")}
        required
        autoFocus
      />
      <TextField
        label={t("password.confirmLabel")}
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
      />
      <SubmitButton variant="primary" pendingLabel={tc("action.saving")} className="h-9 w-full">
        {t("password.submit")}
      </SubmitButton>
    </form>
  );
}
