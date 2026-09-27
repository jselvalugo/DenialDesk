"use client";

import { useActionState } from "react";
import { useT } from "@/i18n/client";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { toggleCustomField, type CustomFieldFormState } from "./actions";

/** Deactivate (hide from forms, keep history) or reactivate a field. */
export function ToggleFieldButton({
  id,
  updatedAt,
  active,
  label,
}: {
  id: string;
  updatedAt: string;
  active: boolean;
  label: string;
}) {
  const [state, action] = useActionState<CustomFieldFormState, FormData>(toggleCustomField, {});
  const t = useT("settings");
  const tc = useT("common");
  const actionLabel = active ? t("fields.deactivate") : t("fields.reactivate");
  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="updatedAt" value={updatedAt} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <SubmitButton
        size="sm"
        variant={active ? "danger" : "secondary"}
        pendingLabel={tc("action.saving")}
        aria-label={t("fields.toggleAria", { action: actionLabel, label })}
      >
        {actionLabel}
      </SubmitButton>
      {state.error && (
        <p role="alert" className="text-label font-medium text-danger-fg">
          {state.error}
        </p>
      )}
    </form>
  );
}
