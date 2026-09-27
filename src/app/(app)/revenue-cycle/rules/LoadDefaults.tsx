"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useT } from "@/i18n/client";
import { loadDefaultRules, type LoadDefaultsState } from "./actions";

export function LoadDefaults() {
  const t = useT("revenue");
  const [state, action] = useActionState<LoadDefaultsState>(loadDefaultRules, {});
  return (
    <form action={action} className="flex flex-col items-start gap-3">
      <FormAlert message={state.error} />
      <SubmitButton variant="primary" pendingLabel={t("rules.loading")}>
        {t("rules.loadDefaults")}
      </SubmitButton>
    </form>
  );
}
