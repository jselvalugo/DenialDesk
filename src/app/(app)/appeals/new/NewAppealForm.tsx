"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormActions, FormNotices } from "@/components/records/FormShell";
import { FormAlert } from "@/components/ui/FormAlert";
import { linkButtonReset } from "@/components/ui/linkButton";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useT } from "@/i18n/client";
import { createAppeal, type CreateAppealState } from "./actions";

export function NewAppealForm({ denialId }: { denialId: string }) {
  const [state, action] = useActionState<CreateAppealState, FormData>(createAppeal, {});
  const t = useT("appeals");
  const tc = useT("common");
  return (
    <form action={action} className="flex flex-col">
      <input type="hidden" name="denialId" value={denialId} />
      <FormNotices>
        <FormAlert message={state.error} />
      </FormNotices>
      <FormActions>
        <SubmitButton variant="primary" pendingLabel={t("action.starting")}>
          {t("action.startAppeal")}
        </SubmitButton>
        <Link href={`/denials/${denialId}`} className={linkButtonReset}>
          {tc("action.cancel")}
        </Link>
      </FormActions>
    </form>
  );
}
