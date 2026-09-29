"use client";

import { startTransition, useActionState } from "react";
import { FormActions, FormNotices, FormSection } from "@/components/records/FormShell";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { useFormat, useT } from "@/i18n/client";
import { generateClaim837PAction, type Claim837State } from "./edi-actions";

/** X12 has no registered browser type; plain text keeps the download from being opened as something else. */
const FILE_TYPE = "text/plain;charset=utf-8";

function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: FILE_TYPE }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Revoked after the browser has started the download, not in the same tick.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Generate, preview, and download the 837P for a draft or rejected claim (docs/specs/claims.md C3a).
 * The screen shows the file with the member ID and tax ID masked; the download has them in full. The
 * response is held in this component's state only: nothing is stored, and nothing goes in a URL.
 */
export function Claim837Form({
  claimId,
  diagnosisCodes,
  lines,
}: {
  claimId: string;
  diagnosisCodes: string[];
  lines: { lineNumber: number; procedureCode: string }[];
}) {
  const t = useT("claims");
  const f = useFormat();
  const [state, action, pending] = useActionState<Claim837State, FormData>(generateClaim837PAction, {});
  const result = state.result;
  const choosePointers = diagnosisCodes.length > 1;

  return (
    // Submitted via onSubmit (not the action prop) so React keeps the ticked boxes when the server refuses.
    <form
      aria-label={t("edi.title")}
      className="flex flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <input type="hidden" name="claimId" value={claimId} />
      <FormNotices>
        <p className="text-label text-muted">{t("edi.testNotice")}</p>
        <FormAlert message={state.error} />
        {state.issues && state.issues.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-body text-danger-fg">
            {state.issues.map((issue, i) => (
              <li key={`${i}-${issue}`}>{issue}</li>
            ))}
          </ul>
        )}
        {result?.pastFilingDeadline && (
          <p role="note" className="text-body text-warning-fg">
            {t("edi.result.pastDeadline")}
          </p>
        )}
      </FormNotices>

      {choosePointers && (
        <FormSection title={t("edi.pointers.title")} description={t("edi.pointers.description")}>
          <div className="flex flex-col gap-3">
            {lines.map((line) => (
              <fieldset key={line.lineNumber} className="flex flex-col gap-1">
                <legend className="text-label font-medium text-text">
                  {t("edi.pointers.line", { line: line.lineNumber, code: line.procedureCode })}
                </legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {diagnosisCodes.map((code, index) => (
                    <label key={index} className="flex items-center gap-1.5 text-body text-text">
                      <input
                        type="checkbox"
                        name={`pointer-${line.lineNumber}`}
                        value={index + 1}
                        className="h-4 w-4 rounded-control border-border-strong"
                      />
                      <span className="font-mono">
                        {t("edi.pointers.option", { position: index + 1, code })}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </FormSection>
      )}

      {result && (
        <FormSection title={t("edi.result.title")} description={t("edi.result.masked")}>
          <p role="status" className="text-body font-medium text-success-fg">
            {t("edi.result.summary", {
              controlNumber: String(result.controlNumber).padStart(9, "0"),
              segments: f.number(result.segmentCount),
              lines: result.lineCount,
            })}
          </p>
          <p className="text-label text-muted">{t("edi.result.testFile")}</p>
          <pre
            tabIndex={0}
            aria-label={t("edi.result.previewLabel")}
            className="max-h-80 overflow-auto rounded-control border border-border bg-surface-muted p-3 font-mono text-label text-text"
          >
            {result.preview}
          </pre>
        </FormSection>
      )}

      <FormActions>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? t("edi.generating") : t("edi.generate")}
        </Button>
        {result && (
          <Button type="button" onClick={() => download(result.text, result.filename)}>
            {t("edi.result.download")}
          </Button>
        )}
      </FormActions>
    </form>
  );
}
