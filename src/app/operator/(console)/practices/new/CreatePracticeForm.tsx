"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { FormActions, FormNotices, FormRow, FormSection } from "@/components/records/FormShell";
import { Button } from "@/components/ui/Button";
import { linkButtonReset, primaryLinkButtonClass } from "@/components/ui/linkButton";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import { useT } from "@/i18n/client";
import { createPractice, type CreateState } from "../../actions";

/** Remounting on "Create another" drops the action state, so the one-time password leaves the page. */
export function CreatePracticeForm() {
  const [round, setRound] = useState(0);
  return <CreatePracticeRound key={round} onAnother={() => setRound((r) => r + 1)} />;
}

function CreatePracticeRound({ onAnother }: { onAnother: () => void }) {
  const [state, action] = useActionState<CreateState, FormData>(createPractice, {});
  const t = useT("operator");
  const tc = useT("common");

  if (state.created) {
    const { tenantId, name, adminEmail, temporaryPassword } = state.created;
    return (
      <div className="flex flex-col gap-4 p-5">
        <div role="status" className="rounded-panel border border-success-border bg-success-bg p-4">
          <p className="text-body font-semibold text-success-fg">
            {t("newPractice.createdHeading", { name })}
          </p>
          <p className="mt-1 text-body text-text">{t("newPractice.sendDetails")}</p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body">
            <dt className="text-muted">{tc("word.email")}</dt>
            <dd className="font-mono">{adminEmail}</dd>
            <dt className="text-muted">{t("newPractice.temporaryPasswordLabel")}</dt>
            <dd className="font-mono">{temporaryPassword}</dd>
          </dl>
          <p className="mt-2 text-label text-muted">{t("newPractice.mfaHint")}</p>
        </div>
        <div className="flex items-center gap-4">
          <Link href={`/operator/practices/${tenantId}`} className={primaryLinkButtonClass}>
            {t("newPractice.openPractice")}
          </Link>
          <Link href="/operator" className="text-body font-medium text-link hover:underline">
            {t("nav.allPractices")}
          </Link>
          <Button variant="ghost" onClick={onAnother}>
            {t("newPractice.createAnother")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col" noValidate>
      <FormNotices>
        <FormAlert message={state.error} />
      </FormNotices>
      <FormSection title={t("newPractice.sectionTitle")}>
        <TextField label={t("newPractice.practiceNameLabel")} name="name" required maxLength={120} />
        <FormRow columns="md:grid-cols-2">
          <TextField label={t("newPractice.adminNameLabel")} name="adminName" required maxLength={120} />
          <TextField
            label={t("newPractice.adminEmailLabel")}
            name="adminEmail"
            type="email"
            required
            maxLength={254}
          />
        </FormRow>
      </FormSection>
      <FormActions>
        <SubmitButton variant="primary" pendingLabel={t("newPractice.creating")}>
          {t("newPractice.submit")}
        </SubmitButton>
        <Link href="/operator" className={linkButtonReset}>
          {tc("action.cancel")}
        </Link>
      </FormActions>
    </form>
  );
}
