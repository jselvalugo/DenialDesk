"use client";

import { startTransition, useActionState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { useT } from "@/i18n/client";
import { syncNowAction } from "../actions";
import type { SyncNowState } from "../form-state";

/**
 * Sync now (docs/specs/patient-integrations.md PI2b): a server action (POST), never a link. The
 * result is the run's translated sentence (counts, why it stopped, or that it was queued for the background
 * worker) shown as text with a badge,
 * never colour alone; a refusal (rate limit, not active) shows as an alert.
 */
export function SyncNowForm({ id }: { id: string }) {
  const t = useT("integrations");
  const [state, action, pending] = useActionState<SyncNowState, FormData>(syncNowAction, {});
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
      <FormAlert message={state.error} id="sync-error" />
      {state.status && state.message && (
        <div role="status" className="flex flex-col items-start gap-2 text-body text-text">
          <Badge
            tone={state.status === "succeeded" ? "success" : state.status === "queued" ? "info" : "danger"}
          >
            {state.status === "succeeded"
              ? t("sync.resultOk")
              : state.status === "queued"
                ? t("sync.resultQueued")
                : t("sync.resultFailed")}
          </Badge>
          <p>{state.message}</p>
        </div>
      )}
      <Button type="submit" variant="secondary" disabled={pending} aria-disabled={pending}>
        {pending ? t("sync.pending") : t("sync.submit")}
      </Button>
    </form>
  );
}
