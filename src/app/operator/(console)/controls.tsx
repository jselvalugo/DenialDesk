"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useT } from "@/i18n/client";
import { toggleSuspended, type ActionState } from "./actions";

export function SuspendToggle({
  tenantId,
  suspended,
  name,
}: {
  tenantId: string;
  suspended: boolean;
  name: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(toggleSuspended, {});
  const t = useT("operator");
  const tc = useT("common");
  return (
    <form action={action} className="flex items-center justify-end gap-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="suspend" value={suspended ? "false" : "true"} />
      {state.error && (
        <span role="alert" className="text-label text-danger-fg">
          {state.error}
        </span>
      )}
      <SubmitButton
        size="sm"
        variant={suspended ? "secondary" : "danger"}
        pendingLabel={tc("action.saving")}
        aria-label={t(suspended ? "list.reactivateAria" : "list.suspendAria", { name })}
      >
        {t(suspended ? "list.reactivate" : "list.suspend")}
      </SubmitButton>
    </form>
  );
}
