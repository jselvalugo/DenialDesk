"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { submitCorrection, type CorrectionState } from "./actions";

const inputClass =
  "h-8 w-full rounded-control border border-border-strong bg-surface px-2 text-body text-text focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus";

export interface CorrectionLine {
  lineNumber: number;
  procedureCode: string;
  modifiers: string[];
  units: number;
  chargeCents: number;
}

/**
 * Correct a draft or rejected claim. Every change is saved as a new claim version with the reason
 * given here (R-3.10.3); nothing is changed automatically (R-3.10.1).
 */
export function CorrectionForm({
  claimId,
  version,
  serviceDate,
  diagnosisCodes,
  lines,
}: {
  claimId: string;
  version: number;
  serviceDate: string;
  diagnosisCodes: string[];
  lines: CorrectionLine[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<CorrectionState, FormData>(submitCorrection, {});

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          Correct claim
        </Button>
        {state.savedVersion && (
          <p role="status" className="text-label font-medium text-success-fg">
            Saved as version {state.savedVersion}.
          </p>
        )}
      </div>
    );
  }

  return (
    // Submitted via onSubmit (not the action prop) so React keeps the typed values when the server
    // rejects them. key: a saved version remounts the form with the new values.
    <form
      key={version}
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => action(formData));
      }}
      className="flex flex-col gap-4"
      aria-label="Correct claim"
    >
      <input type="hidden" name="claimId" value={claimId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <FormAlert message={state.error} />
      {state.savedVersion && !state.error && (
        <p role="status" className="text-label font-medium text-success-fg">
          Saved as version {state.savedVersion}.
        </p>
      )}
      <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-4">
        <label className="flex flex-col gap-1 text-label font-medium text-text">
          Date of service
          <input type="date" name="serviceDate" defaultValue={serviceDate} required className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-label font-medium text-text">
          Diagnosis codes (ICD-10-CM, separated by commas)
          <input
            name="diagnosisCodes"
            defaultValue={diagnosisCodes.join(", ")}
            required
            autoComplete="off"
            className={`${inputClass} font-mono`}
          />
        </label>
      </div>

      <table className="w-full text-body">
        <caption className="sr-only">Claim lines to correct</caption>
        <thead>
          <tr className="text-left text-label text-muted">
            <th className="pb-1 font-medium">Line</th>
            <th className="pb-1 font-medium">Procedure</th>
            <th className="pb-1 font-medium">Modifiers</th>
            <th className="pb-1 font-medium">Units</th>
            <th className="pb-1 font-medium">Charge ($)</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.lineNumber}>
              <td className="pr-3 tabular">
                {line.lineNumber}
                <input type="hidden" name="lineNumber" value={line.lineNumber} />
              </td>
              <td className="py-1 pr-3">
                <input
                  aria-label={`Line ${line.lineNumber} procedure code`}
                  name={`line-${line.lineNumber}-procedureCode`}
                  defaultValue={line.procedureCode}
                  required
                  maxLength={5}
                  autoComplete="off"
                  className={`${inputClass} font-mono`}
                />
              </td>
              <td className="py-1 pr-3">
                <input
                  aria-label={`Line ${line.lineNumber} modifiers`}
                  name={`line-${line.lineNumber}-modifiers`}
                  defaultValue={line.modifiers.join(", ")}
                  autoComplete="off"
                  className={`${inputClass} font-mono`}
                />
              </td>
              <td className="py-1 pr-3">
                <input
                  aria-label={`Line ${line.lineNumber} units`}
                  name={`line-${line.lineNumber}-units`}
                  type="number"
                  min={1}
                  max={999}
                  defaultValue={line.units}
                  required
                  className={`${inputClass} tabular`}
                />
              </td>
              <td className="py-1">
                <input
                  aria-label={`Line ${line.lineNumber} charge`}
                  name={`line-${line.lineNumber}-charge`}
                  inputMode="decimal"
                  defaultValue={(line.chargeCents / 100).toFixed(2)}
                  required
                  className={`${inputClass} tabular`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <label className="flex flex-col gap-1 text-label font-medium text-text">
        Reason for the correction (required, saved in the claim history)
        <textarea
          name="reason"
          required
          minLength={5}
          maxLength={500}
          rows={2}
          className="rounded-control border border-border-strong bg-surface px-2 py-1.5 text-body text-text focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus"
        />
      </label>
      <p className="text-label text-muted">
        Don&apos;t put patient details in the reason. Code changes must be supported by the medical record.
      </p>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending} aria-disabled={pending}>
          {pending ? "Saving…" : "Save new version"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
