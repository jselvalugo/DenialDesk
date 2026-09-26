"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { postRemittanceAction, voidRemittanceAction, type RemittanceActionState } from "../actions";

/** Post (primary) and void (with a required reason) for a remittance that is ready to post. */
export function RemittanceActions({
  remittanceId,
  canPost,
  canVoid,
  balanced,
}: {
  remittanceId: string;
  canPost: boolean;
  canVoid: boolean;
  balanced: boolean;
}) {
  const [postState, post] = useActionState<RemittanceActionState, FormData>(postRemittanceAction, {});
  const [voidState, voidIt] = useActionState<RemittanceActionState, FormData>(voidRemittanceAction, {});
  const [voiding, setVoiding] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <FormAlert message={postState.error ?? voidState.error} />
      {canPost && (
        <form action={post} className="flex flex-col gap-2">
          <input type="hidden" name="remittanceId" value={remittanceId} />
          <p className="text-body text-text">
            Posting updates each claim&apos;s paid amount and status (a new claim version) and records the
            payment or denial on its prompt-pay clock. It can&apos;t be undone here.
          </p>
          <div>
            <SubmitButton variant="primary" pendingLabel="Posting…" disabled={!balanced}>
              Post payments
            </SubmitButton>
          </div>
          {!balanced && (
            <p className="text-label text-danger-fg">
              This file doesn&apos;t balance, so it can&apos;t be posted.
            </p>
          )}
        </form>
      )}
      {canVoid &&
        (voiding ? (
          <form
            action={voidIt}
            className="flex flex-col gap-2 border-t border-border pt-3"
            aria-label="Void remittance"
          >
            <input type="hidden" name="remittanceId" value={remittanceId} />
            <label className="flex flex-col gap-1 text-label font-medium text-text">
              Why is this remittance being voided?
              <textarea
                name="reason"
                required
                minLength={5}
                maxLength={500}
                rows={3}
                className="rounded-control border border-border-strong bg-surface px-2 py-1.5 text-body text-text focus:border-focus focus:outline-2 focus:outline-focus"
              />
            </label>
            <div className="flex gap-2">
              <SubmitButton variant="danger" pendingLabel="Voiding…">
                Void remittance
              </SubmitButton>
              <Button type="button" variant="ghost" onClick={() => setVoiding(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button type="button" variant="secondary" onClick={() => setVoiding(true)}>
              Void…
            </Button>
          </div>
        ))}
    </div>
  );
}
