"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { linkButtonReset } from "@/components/ui/linkButton";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { uploadRemittance, type RemittanceActionState } from "../actions";

export function UploadRemittanceForm({ syntheticOnly }: { syntheticOnly: boolean }) {
  const [state, action] = useActionState<RemittanceActionState, FormData>(uploadRemittance, {});
  return (
    <form action={action} className="flex max-w-[720px] flex-col gap-4" aria-label="Upload remittance">
      <FormAlert message={state.error} />
      <div className="flex flex-col gap-1">
        <label htmlFor="file" className="text-label font-medium text-text">
          835 remittance file (one payment, up to 5 MB)
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
          The payer must be set up with its EDI payer ID, and every claim in the file must already be in
          DenialDesk. Nothing changes on a claim until you post the remittance.
        </p>
      </div>
      {syntheticOnly && (
        <label className="flex items-start gap-2 text-body text-text">
          <input type="checkbox" name="syntheticAttestation" required className="mt-0.5 size-4" />
          <span>
            This file contains synthetic data only. Real remittances are not allowed in this environment.
          </span>
        </label>
      )}
      <div className="flex gap-2">
        <SubmitButton variant="primary" pendingLabel="Checking…">
          Upload and check
        </SubmitButton>
        <Link href="/remittances" className={linkButtonReset}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
