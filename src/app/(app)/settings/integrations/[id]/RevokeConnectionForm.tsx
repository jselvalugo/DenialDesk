"use client";

import { startTransition, useActionState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/SelectField";
import { REVOKE_REASON_CODES, REVOKE_REASON_LABEL_KEYS } from "@/domain/integrations/revoke-reasons";
import { useT } from "@/i18n/client";
import { revokeConnectionAction } from "../actions";
import type { ConnectionFormState } from "../form-state";

/**
 * Revoke with inline confirmation (DESIGN.md §3): a required reason code (recorded as the audit
 * "why"), a required acknowledgement, then a danger button.
 */
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
      <FormAlert message={state.field === "reason" ? undefined : state.error} id="revoke-error" />
      <SelectField
        label={t("revoke.reason")}
        name="reason"
        required
        defaultValue=""
        hint={t("revoke.reasonHint")}
        error={state.field === "reason" ? state.error : undefined}
        options={[
          { value: "", label: t("revoke.reasonPlaceholder") },
          ...REVOKE_REASON_CODES.map((code) => ({ value: code, label: t(REVOKE_REASON_LABEL_KEYS[code]) })),
        ]}
      />
      <label className="flex items-start gap-2 text-body text-text">
        <input
          type="checkbox"
          name="confirm"
          required
          // Only the missing acknowledgement is this checkbox's error (not a stale page, say).
          aria-invalid={state.field === "confirm" ? true : undefined}
          aria-describedby={state.field === "confirm" ? "revoke-error" : undefined}
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
