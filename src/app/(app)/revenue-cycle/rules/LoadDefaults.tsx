"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { loadDefaultRules, type LoadDefaultsState } from "./actions";

export function LoadDefaults() {
  const [state, action] = useActionState<LoadDefaultsState>(loadDefaultRules, {});
  return (
    <form action={action} className="flex flex-col items-start gap-3">
      <FormAlert message={state.error} />
      <SubmitButton variant="primary" pendingLabel="Loading…">
        Load the default rule set
      </SubmitButton>
    </form>
  );
}
