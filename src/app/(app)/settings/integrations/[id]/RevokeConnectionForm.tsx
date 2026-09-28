"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useT } from "@/i18n/client";
import { revokeConnectionAction } from "../actions";
import type { ConnectionFormState } from "../form-state";

/** Revoke with inline confirmation (DESIGN.md §3): a required acknowledgement, then a danger button. */
export function RevokeConnectionForm({ id, updatedAt }: { id: string; updatedAt: string }) {
  const t = useT("integrations");
  const [state, action] = useActionState<ConnectionFormState, FormData>(revokeConnectionAction, {});
  return (
    <form action={action} className="flex flex-col items-start gap-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="updatedAt" value={updatedAt} />
      <FormAlert message={state.error} />
      <label className="flex items-start gap-2 text-body text-text">
        <input type="checkbox" name="confirm" required className="mt-1 size-4" />
        <span>{t("revoke.confirm")}</span>
      </label>
      <SubmitButton variant="danger" pendingLabel={t("revoke.pending")}>
        {t("revoke.submit")}
      </SubmitButton>
    </form>
  );
}
