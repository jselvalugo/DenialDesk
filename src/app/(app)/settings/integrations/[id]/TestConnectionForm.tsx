"use client";

import { startTransition, useActionState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { useT } from "@/i18n/client";
import { testConnectionAction } from "../actions";
import type { TestConnectionState } from "../form-state";

/**
 * Test connection (docs/specs/patient-integrations.md PI2a): discovery plus one token request, no
 * patient data. The result is the collapsed outcome's translated sentence, shown as text with a badge
 * (never colour alone); a refusal (not configured, rate limited) shows as an alert.
 */
export function TestConnectionForm({ id }: { id: string }) {
  const t = useT("integrations");
  const [state, action, pending] = useActionState<TestConnectionState, FormData>(testConnectionAction, {});
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => action(formData));
      }}
      className="flex flex-col items-start gap-3"
    >
      <input type="hidden" name="id" value={id} />
      <FormAlert message={state.error} id="test-error" />
      {state.outcome && state.message && (
        <div role="status" className="flex flex-col items-start gap-2 text-body text-text">
          <Badge tone={state.outcome === "ok" ? "success" : "danger"}>
            {state.outcome === "ok" ? t("test.resultOk") : t("test.resultFailed")}
          </Badge>
          <p>{state.message}</p>
        </div>
      )}
      <Button type="submit" variant="secondary" disabled={pending} aria-disabled={pending}>
        {pending ? t("test.pending") : t("test.submit")}
      </Button>
    </form>
  );
}
