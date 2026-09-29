"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useT } from "@/i18n/client";
import { saveAppealTemplate, type TemplateActionState } from "./actions";

export function TemplateForm({
  category,
  defaultBody,
  starterBody,
  editable,
}: {
  category: string;
  defaultBody: string;
  /** The starter wording, offered as a way back to the shipped text. */
  starterBody: string;
  editable: boolean;
}) {
  const [state, action] = useActionState<TemplateActionState, FormData>(saveAppealTemplate, {});
  // Controlled, so a refused save (unknown field) does not lose the edit to React 19's form reset.
  const [text, setText] = useState(defaultBody);
  const t = useT("settings");
  const tc = useT("common");
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="category" value={category} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="template-body" className="text-label font-medium text-text">
          {t("appealTemplates.bodyLabel")}
        </label>
        <textarea
          id="template-body"
          name="body"
          rows={24}
          maxLength={20000}
          spellCheck
          readOnly={!editable}
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-describedby="template-body-hint"
          className="rounded-control border border-border-strong bg-surface px-3 py-2 font-mono text-body text-text focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus"
        />
        <p id="template-body-hint" className="text-label text-muted">
          {t("appealTemplates.bodyHint", { example: "{{claim.number}}" })}
        </p>
      </div>
      {state.error && (
        <p role="alert" className="text-label font-medium text-danger-fg">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="text-label font-medium text-success-fg">
          {t("appealTemplates.saved")}
        </p>
      )}
      {editable && (
        <div className="flex items-center gap-3">
          <SubmitButton variant="primary" pendingLabel={tc("action.saving")}>
            {t("appealTemplates.save")}
          </SubmitButton>
          <button
            type="button"
            onClick={() => setText(starterBody)}
            className="inline-flex h-8 items-center rounded-control px-3 text-body font-medium text-muted hover:bg-surface-muted hover:text-text"
          >
            {t("appealTemplates.useStarter")}
          </button>
        </div>
      )}
    </form>
  );
}
