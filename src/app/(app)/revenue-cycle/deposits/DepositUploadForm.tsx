"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import { reverseDeposits, uploadDeposits, type DepositUploadState } from "./actions";

export function DepositUploadForm({ syntheticOnly }: { syntheticOnly: boolean }) {
  const [state, action] = useActionState<DepositUploadState, FormData>(uploadDeposits, {});
  return (
    <form action={action} className="flex flex-col items-start gap-3">
      <FormAlert message={state.error} />
      {state.problems && state.problems.length > 0 && (
        <ul aria-label="Problems in the file" className="list-disc pl-5 text-body text-danger-fg">
          {state.problems.map((p) => (
            <li key={`${p.row}-${p.message}`}>
              Row {p.row}: {p.message}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="deposit-file" className="text-label font-medium text-text">
          Bank deposits (CSV, up to 1 MB)
        </label>
        <input
          id="deposit-file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className="text-body"
        />
      </div>
      {syntheticOnly && (
        <label className="flex items-start gap-2 text-body text-text">
          <input type="checkbox" name="syntheticAttestation" required className="mt-1" />
          <span>
            This file contains synthetic data only (this environment doesn&apos;t accept real bank data).
          </span>
        </label>
      )}
      <SubmitButton variant="primary" pendingLabel="Importing…">
        Import deposits
      </SubmitButton>
    </form>
  );
}

export function ReverseDepositsForm({ fileId }: { fileId: string }) {
  const [state, action] = useActionState<DepositUploadState, FormData>(reverseDeposits, {});
  return (
    <details>
      <summary className="cursor-pointer text-label font-medium text-link">Reverse</summary>
      <form action={action} className="mt-2 flex flex-col items-start gap-2">
        <FormAlert message={state.error} />
        <input type="hidden" name="fileId" value={fileId} />
        <TextField
          label="Reason"
          name="reason"
          required
          minLength={10}
          maxLength={500}
          hint="Recorded in the audit trail. No patient information."
          className="w-72 max-w-full"
        />
        <SubmitButton variant="danger" size="sm" pendingLabel="Reversing…">
          Reverse this file
        </SubmitButton>
      </form>
    </details>
  );
}
