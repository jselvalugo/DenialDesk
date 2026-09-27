"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useT } from "@/i18n/client";
import { createAppeal, type CreateAppealState } from "./actions";

export function NewAppealForm({ denialId }: { denialId: string }) {
  const [state, action] = useActionState<CreateAppealState, FormData>(createAppeal, {});
  const t = useT("appeals");
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="denialId" value={denialId} />
      <FormAlert message={state.error} />
      <div>
        <SubmitButton variant="primary" pendingLabel={t("action.starting")}>
          {t("action.startAppeal")}
        </SubmitButton>
      </div>
    </form>
  );
}
