"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useT } from "@/i18n/client";
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
  const t = useT("remittances");
  const tc = useT("common");
  return (
    <div className="flex flex-col gap-3">
      <FormAlert message={postState.error ?? voidState.error} />
      {canPost && (
        <form action={post} className="flex flex-col gap-2">
          <input type="hidden" name="remittanceId" value={remittanceId} />
          <p className="text-body text-text">{t("actions.postExplain")}</p>
          <div>
            <SubmitButton variant="primary" pendingLabel={t("actions.posting")} disabled={!balanced}>
              {t("actions.postSubmit")}
            </SubmitButton>
          </div>
          {!balanced && <p className="text-label text-danger-fg">{t("actions.notBalanced")}</p>}
        </form>
      )}
      {canVoid &&
        (voiding ? (
          <form
            action={voidIt}
            className="flex flex-col gap-2 border-t border-border pt-3"
            aria-label={t("actions.voidSubmit")}
          >
            <input type="hidden" name="remittanceId" value={remittanceId} />
            <label className="flex flex-col gap-1 text-label font-medium text-text">
              {t("actions.voidPrompt")}
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
              <SubmitButton variant="danger" pendingLabel={t("actions.voiding")}>
                {t("actions.voidSubmit")}
              </SubmitButton>
              <Button type="button" variant="ghost" onClick={() => setVoiding(false)}>
                {tc("action.cancel")}
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button type="button" variant="secondary" onClick={() => setVoiding(true)}>
              {t("actions.voidButton")}
            </Button>
          </div>
        ))}
    </div>
  );
}
