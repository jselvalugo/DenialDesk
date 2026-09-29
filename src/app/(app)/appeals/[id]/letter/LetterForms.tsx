"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useT } from "@/i18n/client";
import { attestLetterAction, saveLetter, type LetterActionState } from "./actions";

function Feedback({ state, okText }: { state: LetterActionState; okText?: string }) {
  if (state.error) {
    return (
      <p role="alert" className="text-label font-medium text-danger-fg">
        {state.error}
      </p>
    );
  }
  if (state.ok && okText) {
    return (
      <p role="status" className="text-label font-medium text-success-fg">
        {okText}
      </p>
    );
  }
  return null;
}

/** The letter body and its save button. The parent re-renders with the new base version after a save. */
export function LetterEditor({
  appealId,
  defaultBody,
  baseVersion,
  sourceCategory,
  editable,
}: {
  appealId: string;
  defaultBody: string;
  baseVersion: number;
  sourceCategory: string;
  editable: boolean;
}) {
  const [state, action] = useActionState<LetterActionState, FormData>(saveLetter, {});
  // Controlled, so React 19's form reset after an action cannot throw away edits when a save is refused.
  // The parent gives this component a new `key` when the version or the loaded template changes.
  const [text, setText] = useState(defaultBody);
  const t = useT("appeals");
  const tc = useT("common");
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="appealId" value={appealId} />
      <input type="hidden" name="baseVersion" value={baseVersion} />
      <input type="hidden" name="sourceCategory" value={sourceCategory} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="letter-body" className="text-label font-medium text-text">
          {t("letter.editor.label")}
        </label>
        <textarea
          id="letter-body"
          name="body"
          rows={22}
          maxLength={20000}
          spellCheck
          readOnly={!editable}
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-describedby="letter-body-hint"
          className="rounded-control border border-border-strong bg-surface px-3 py-2 font-mono text-body text-text focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus"
        />
        <p id="letter-body-hint" className="text-label text-muted">
          {t("letter.editor.hint", { example: "{{claim.number}}" })}
        </p>
      </div>
      <Feedback state={state} okText={t("letter.editor.saved")} />
      {editable && (
        <div>
          <SubmitButton variant="primary" pendingLabel={tc("action.saving")}>
            {t("letter.editor.save", { version: baseVersion + 1 })}
          </SubmitButton>
        </div>
      )}
    </form>
  );
}

/** The named-user review (R-7.11.2): an explicit statement and a button, for one version. */
export function AttestForm({ appealId, version }: { appealId: string; version: number }) {
  const [state, action] = useActionState<LetterActionState, FormData>(attestLetterAction, {});
  const t = useT("appeals");
  const tc = useT("common");
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="appealId" value={appealId} />
      <input type="hidden" name="version" value={version} />
      <label className="flex items-start gap-2 text-body text-text">
        <input type="checkbox" name="confirm" required className="mt-1" />
        <span>{t("letter.review.statement")}</span>
      </label>
      <Feedback state={state} />
      <div>
        <SubmitButton variant="primary" pendingLabel={tc("action.saving")}>
          {t("letter.review.button")}
        </SubmitButton>
      </div>
    </form>
  );
}
