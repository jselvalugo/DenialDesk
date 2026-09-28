"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormActions, FormNotices, FormSection } from "@/components/records/FormShell";
import { FormAlert } from "@/components/ui/FormAlert";
import { linkButtonReset } from "@/components/ui/linkButton";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextareaField } from "@/components/ui/TextareaField";
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
    <form action={action} className="flex flex-col" aria-label={t("newContest.title")}>
      <input type="hidden" name="claimId" value={claimId} />
      <FormNotices>
        <FormAlert message={state.error} />
      </FormNotices>
      <FormSection title={t("newContest.sectionTitle")}>
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
        <TextareaField
          label={t("contestForm.noteLabel")}
          name="note"
          required
          minLength={5}
          maxLength={500}
          rows={4}
        />
      </FormSection>
      <FormActions>
        <SubmitButton variant="primary" pendingLabel={t("contestForm.saving")}>
          {t("contestForm.submit")}
        </SubmitButton>
        <Link href={`/prompt-pay/${claimId}`} className={linkButtonReset}>
          {tc("action.cancel")}
        </Link>
      </FormActions>
    </form>
  );
}
