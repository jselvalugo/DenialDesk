"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormActions, FormNotices, FormSection } from "@/components/records/FormShell";
import { FormAlert } from "@/components/ui/FormAlert";
import { linkButtonReset } from "@/components/ui/linkButton";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useT } from "@/i18n/client";
import { uploadRemittance, type RemittanceActionState } from "../actions";

export function UploadRemittanceForm({ syntheticOnly }: { syntheticOnly: boolean }) {
  const [state, action] = useActionState<RemittanceActionState, FormData>(uploadRemittance, {});
  const t = useT("remittances");
  const tc = useT("common");
  return (
    <form action={action} className="flex flex-col" aria-label={t("new.title")}>
      <FormNotices>
        <FormAlert message={state.error} />
      </FormNotices>
      <FormSection title={t("upload.sectionTitle")}>
        <div className="flex flex-col gap-1">
          <label htmlFor="file" className="text-label font-medium text-text">
            {t("upload.fileLabel")}
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".835,.txt,.edi,.x12,text/plain"
            required
            aria-describedby="file-hint"
            className="text-body text-text file:mr-3 file:h-8 file:rounded-control file:border file:border-border-strong file:bg-surface file:px-3 file:text-body file:font-medium file:text-text hover:file:bg-surface-muted"
          />
          <p id="file-hint" className="text-label text-muted">
            {t("upload.fileHint")}
          </p>
        </div>
        {syntheticOnly && (
          <label className="flex items-start gap-2 text-body text-text">
            <input type="checkbox" name="syntheticAttestation" required className="mt-0.5 size-4" />
            <span>{t("upload.syntheticAttestation")}</span>
          </label>
        )}
      </FormSection>
      <FormActions>
        <SubmitButton variant="primary" pendingLabel={t("upload.checking")}>
          {t("upload.submit")}
        </SubmitButton>
        <Link href="/remittances" className={linkButtonReset}>
          {tc("action.cancel")}
        </Link>
      </FormActions>
    </form>
  );
}
