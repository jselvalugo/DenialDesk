"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import { useT } from "@/i18n/client";
import { grantUniversity, revokeUniversity, type UniversityAccessState } from "../../actions";

/**
 * Grant (record the purchase) or revoke DenialDesk University access for one practice
 * (specs/denialdesk-university.md, "Access"). The page re-renders with the new status after either.
 */
export function UniversityAccessForm({ tenantId, granted }: { tenantId: string; granted: boolean }) {
  const [grantState, grant] = useActionState<UniversityAccessState, FormData>(grantUniversity, {});
  const [revokeState, revoke] = useActionState<UniversityAccessState, FormData>(revokeUniversity, {});
  const t = useT("operator");

  return (
    <div className="flex flex-col gap-4">
      {/* Only the outcome that matches the current state: grant then revoke never shows both. */}
      {granted && grantState.granted && (
        <p
          role="status"
          className="rounded-panel border border-success-border bg-success-bg p-3 text-body text-success-fg"
        >
          {t("university.granted")}
        </p>
      )}
      {!granted && revokeState.revoked && (
        <p
          role="status"
          className="rounded-panel border border-warning-border bg-warning-bg p-3 text-body text-warning-fg"
        >
          {t("university.revoked")}
        </p>
      )}
      {granted ? (
        <form action={revoke} className="flex flex-col gap-4">
          <input type="hidden" name="tenantId" value={tenantId} />
          <FormAlert message={revokeState.error} />
          <TextField
            label={t("university.revokeReasonLabel")}
            name="reason"
            id="university-revoke-reason"
            required
            minLength={5}
            maxLength={500}
            hint={t("university.revokeReasonHint")}
          />
          <div>
            <SubmitButton variant="danger" pendingLabel={t("university.revoking")}>
              {t("university.revoke")}
            </SubmitButton>
          </div>
        </form>
      ) : (
        <form action={grant} className="flex flex-col gap-4">
          <input type="hidden" name="tenantId" value={tenantId} />
          <FormAlert message={grantState.error} />
          <TextField
            label={t("university.noteLabel")}
            name="note"
            id="university-note"
            maxLength={200}
            hint={t("university.noteHint")}
          />
          <div>
            <SubmitButton variant="primary" pendingLabel={t("university.granting")}>
              {t("university.grant")}
            </SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
