"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useT } from "@/i18n/client";
import { voidResponseAction, type PromptPayActionState } from "../actions";

/** "Recorded in error": adds a correction with a reason; the original entry stays in the history. */
export function VoidResponseForm({ responseId }: { responseId: string }) {
  const [state, action] = useActionState<PromptPayActionState, FormData>(voidResponseAction, {});
  const [open, setOpen] = useState(false);
  const t = useT("promptPay");
  const tc = useT("common");
  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {t("void.button")}
      </Button>
    );
  }
  return (
    <form action={action} className="mt-2 flex flex-col gap-2" aria-label={t("void.button")}>
      <FormAlert message={state.error} />
      <input type="hidden" name="responseId" value={responseId} />
      <label className="flex flex-col gap-1 text-label font-medium text-text">
        {t("void.prompt")}
        <textarea
          name="reason"
          required
          minLength={5}
          maxLength={500}
          rows={2}
          className="rounded-control border border-border-strong bg-surface px-2 py-1.5 text-body text-text focus:border-focus focus:outline-2 focus:outline-focus"
        />
      </label>
      <div className="flex gap-2">
        <SubmitButton variant="danger" size="sm" pendingLabel={t("void.saving")}>
          {t("void.submit")}
        </SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {tc("action.cancel")}
        </Button>
      </div>
    </form>
  );
}
