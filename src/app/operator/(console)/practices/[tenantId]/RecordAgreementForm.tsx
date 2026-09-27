"use client";

import { useActionState, useEffect, useRef } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import { useT } from "@/i18n/client";
import { rich } from "@/i18n/rich";
import { recordAgreement, type RecordAgreementState } from "../../actions";

/** Records a signed BAA for one practice; a new one supersedes the current active agreement. */
export function RecordAgreementForm({
  tenantId,
  hasActive,
  syntheticOnly,
}: {
  tenantId: string;
  hasActive: boolean;
  /** Pre-production accepts synthetic test documents only (ADR 0003). */
  syntheticOnly: boolean;
}) {
  const [state, action] = useActionState<RecordAgreementState, FormData>(recordAgreement, {});
  const formRef = useRef<HTMLFormElement>(null);
  const t = useT("operator");
  useEffect(() => {
    if (state.recorded) formRef.current?.reset();
  }, [state]);

  return (
    <div className="flex flex-col gap-4">
      {state.recorded && (
        <p
          role="status"
          className="rounded-panel border border-success-border bg-success-bg p-3 text-body text-success-fg"
        >
          {t(
            state.recorded.supersededPrevious ? "agreementForm.recordedSuperseded" : "agreementForm.recorded",
            {
              filename: state.recorded.filename,
            },
          )}
        </p>
      )}
      <form ref={formRef} action={action} className="flex flex-col gap-4">
        <input type="hidden" name="tenantId" value={tenantId} />
        <FormAlert message={state.error} />
        {hasActive && <p className="text-body text-muted">{t("agreementForm.replacesActive")}</p>}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="agreement-file" className="text-label font-medium text-text">
            {t("agreementForm.fileLabel")}
          </label>
          <input
            id="agreement-file"
            name="file"
            type="file"
            accept=".pdf,application/pdf"
            required
            className="text-body text-text file:mr-3 file:h-8 file:rounded-control file:border file:border-border-strong file:bg-surface file:px-3 file:text-body file:font-medium file:text-text hover:file:bg-surface-muted"
          />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <TextField
            label={t("agreementForm.effectiveDateLabel")}
            name="effectiveDate"
            type="date"
            required
          />
          <TextField
            label={t("agreementForm.expiresOnLabel")}
            name="expiresOn"
            type="date"
            hint={t("agreementForm.expiresOnHint")}
          />
          <TextField label={t("agreementForm.signedOnLabel")} name="signedOn" type="date" required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label={t("agreementForm.practiceSignerLabel")}
            name="practiceSigner"
            required
            maxLength={160}
            hint={t("agreementForm.nameAndTitleHint")}
          />
          <TextField
            label={t("agreementForm.ourSignerLabel")}
            name="ourSigner"
            required
            maxLength={160}
            hint={t("agreementForm.nameAndTitleHint")}
          />
        </div>
        <TextField
          label={t("agreementForm.noteLabel")}
          name="note"
          maxLength={500}
          hint={t("agreementForm.noteHint")}
        />
        {syntheticOnly && (
          <label className="flex items-start gap-2 text-body text-text">
            <input type="checkbox" name="syntheticAttestation" required className="mt-0.5 size-4" />
            <span>
              {rich(t("agreementForm.syntheticAttestation", { prefix: "SYN-" }), {
                code: (chunks) => <code>{chunks}</code>,
              })}
            </span>
          </label>
        )}
        <div>
          <SubmitButton variant="primary" pendingLabel={t("agreementForm.recording")}>
            {t("agreementForm.submit")}
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
