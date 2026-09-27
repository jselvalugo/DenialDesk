"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { linkButtonReset } from "@/components/ui/linkButton";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import { useT } from "@/i18n/client";
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
  const t = useT("promptPay");
  const tc = useT("common");
  return (
    <form action={action} className="flex max-w-[720px] flex-col gap-4" aria-label={t("newContest.title")}>
      <FormAlert message={state.error} />
      <input type="hidden" name="claimId" value={claimId} />
      <TextField
        label={t("contestForm.dateLabel")}
        name="responseDate"
        type="date"
        min={minDate}
        max={today}
        required
        className="w-48"
        hint={t("contestForm.dateHint")}
      />
      <label className="flex flex-col gap-1.5 text-label font-medium text-text">
        {t("contestForm.noteLabel")}
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
        <SubmitButton variant="primary" pendingLabel={t("contestForm.saving")}>
          {t("contestForm.submit")}
        </SubmitButton>
        <Link href={`/prompt-pay/${claimId}`} className={linkButtonReset}>
          {tc("action.cancel")}
        </Link>
      </div>
    </form>
  );
}
