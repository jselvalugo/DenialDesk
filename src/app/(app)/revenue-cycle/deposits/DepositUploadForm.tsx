"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { uploadDeposits, type DepositUploadState } from "./actions";

export function DepositUploadForm() {
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
      <SubmitButton variant="primary" pendingLabel="Importing…">
        Import deposits
      </SubmitButton>
    </form>
  );
}
