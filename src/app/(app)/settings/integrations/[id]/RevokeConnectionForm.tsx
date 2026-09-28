"use client";

import { startTransition, useActionState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { Button } from "@/components/ui/Button";
import { useT } from "@/i18n/client";
import { revokeConnectionAction } from "../actions";
import type { ConnectionFormState } from "../form-state";

/** Revoke with inline confirmation (DESIGN.md §3): a required acknowledgement, then a danger button. */
export function RevokeConnectionForm({ id, updatedAt }: { id: string; updatedAt: string }) {
  const t = useT("integrations");
  const [state, action, pending] = useActionState<ConnectionFormState, FormData>(revokeConnectionAction, {});
  return (
    // noValidate: the translated refusal (checked on the server) shows instead of the browser's bubble.
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => action(formData));
      }}
      className="flex flex-col items-start gap-3"
      noValidate
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="updatedAt" value={updatedAt} />
      <FormAlert message={state.error} id="revoke-error" />
      <label className="flex items-start gap-2 text-body text-text">
        <input
          type="checkbox"
          name="confirm"
          required
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "revoke-error" : undefined}
          className="mt-1 size-4"
        />
        <span>{t("revoke.confirm")}</span>
      </label>
      <Button type="submit" variant="danger" disabled={pending} aria-disabled={pending}>
        {pending ? t("revoke.pending") : t("revoke.submit")}
      </Button>
    </form>
  );
}
