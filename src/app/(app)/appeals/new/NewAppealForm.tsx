"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { createAppeal, type CreateAppealState } from "./actions";

export function NewAppealForm({ denialId }: { denialId: string }) {
  const [state, action] = useActionState<CreateAppealState, FormData>(createAppeal, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="denialId" value={denialId} />
      <FormAlert message={state.error} />
      <div>
        <SubmitButton variant="primary" pendingLabel="Starting…">
          Start appeal
        </SubmitButton>
      </div>
    </form>
  );
}
