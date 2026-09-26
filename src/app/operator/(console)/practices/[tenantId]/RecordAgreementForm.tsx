"use client";

import { useActionState, useEffect, useRef } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";
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
          {state.recorded.filename} recorded as the active agreement
          {state.recorded.supersededPrevious ? "; the previous agreement is kept as superseded." : "."}
        </p>
      )}
      <form ref={formRef} action={action} className="flex flex-col gap-4">
        <input type="hidden" name="tenantId" value={tenantId} />
        <FormAlert message={state.error} />
        {hasActive && (
          <p className="text-body text-muted">
            Recording a new agreement replaces the current active one. The current one stays on file as
            superseded.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="agreement-file" className="text-label font-medium text-text">
            Signed agreement (PDF, up to 5 MB)
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
          <TextField label="Effective date" name="effectiveDate" type="date" required />
          <TextField
            label="Expires on"
            name="expiresOn"
            type="date"
            hint="Leave blank if it runs until terminated."
          />
          <TextField label="Date signed" name="signedOn" type="date" required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="Signed for the practice by"
            name="practiceSigner"
            required
            maxLength={160}
            hint="Name and title."
          />
          <TextField
            label="Signed for DenialDesk by"
            name="ourSigner"
            required
            maxLength={160}
            hint="Name and title."
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <TextField
            label="BAA template version"
            name="templateVersion"
            required
            maxLength={40}
            hint="The counsel-reviewed template this agreement was signed on."
          />
          <TextField label="Note" name="note" maxLength={500} hint="Optional. No patient information." />
        </div>
        {syntheticOnly && (
          <label className="flex items-start gap-2 text-body text-text">
            <input type="checkbox" name="syntheticAttestation" required className="mt-0.5 size-4" />
            <span>
              This is a synthetic test document, not a real agreement. Its file name starts with{" "}
              <code>SYN-</code>; real agreements are rejected in this environment.
            </span>
          </label>
        )}
        <div>
          <SubmitButton variant="primary" pendingLabel="Recording…">
            Record agreement
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
