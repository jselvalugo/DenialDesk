"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { linkButtonReset } from "@/components/ui/linkButton";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import { recordContestAction, type PromptPayActionState } from "../../../actions";

export function ContestForm({
  claimId,
  minDate,
  today,
}: {
  claimId: string;
  minDate: string;
  today: string;
}) {
  const [state, action] = useActionState<PromptPayActionState, FormData>(recordContestAction, {});
  return (
    <form action={action} className="flex max-w-[720px] flex-col gap-4" aria-label="Record payer contest">
      <FormAlert message={state.error} />
      <input type="hidden" name="claimId" value={claimId} />
      <TextField
        label="Date on the payer's notice"
        name="responseDate"
        type="date"
        min={minDate}
        max={today}
        required
        className="w-48"
        hint="The date the payer contested the claim or asked for information."
      />
      <label className="flex flex-col gap-1.5 text-label font-medium text-text">
        What did the payer ask for?
        <textarea
          name="note"
          required
          minLength={5}
          maxLength={500}
          rows={4}
          className="rounded-control border border-border-strong bg-surface px-3 py-2 text-body text-text focus:border-focus focus:outline-2 focus:outline-focus"
        />
      </label>
      <div className="flex gap-2">
        <SubmitButton variant="primary" pendingLabel="Saving…">
          Record contest
        </SubmitButton>
        <Link href={`/prompt-pay/${claimId}`} className={linkButtonReset}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
