"use client";

import { useActionState } from "react";
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
  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="updatedAt" value={updatedAt} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <SubmitButton
        size="sm"
        variant={active ? "danger" : "secondary"}
        pendingLabel="Saving…"
        aria-label={`${active ? "Deactivate" : "Reactivate"} ${label}`}
      >
        {active ? "Deactivate" : "Reactivate"}
      </SubmitButton>
      {state.error && (
        <p role="alert" className="text-label font-medium text-danger-fg">
          {state.error}
        </p>
      )}
    </form>
  );
}
