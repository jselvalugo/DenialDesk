"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { SelectField } from "@/components/ui/SelectField";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { REJECT_REASON_CODES, REJECT_REASON_LABEL_KEYS } from "@/domain/integrations/approval-codes";
import { useT } from "@/i18n/client";
import { rejectIntegration, type IntegrationDecisionState } from "../../../../actions";

/**
 * Reject a submitted connection with a reason code from a fixed vocabulary (no free text, so no
 * patient information can reach the practice's page or the audit trail). The practice sees the
 * reason; the connection goes back to draft and its endpoint claim is released.
 */
export function RejectConnectionForm({
  tenantId,
  connectionId,
  updatedAt,
}: {
  tenantId: string;
  connectionId: string;
  updatedAt: string;
}) {
  const [state, action] = useActionState<IntegrationDecisionState, FormData>(rejectIntegration, {});
  const t = useT("operator");

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="connectionId" value={connectionId} />
      <input type="hidden" name="updatedAt" value={updatedAt} />
      <FormAlert message={state.error} />
      <SelectField
        label={t("integrations.reject.reasonLabel")}
        name="reasonCode"
        id="reject-reason"
        required
        options={[
          { value: "", label: t("integrations.choose") },
          ...REJECT_REASON_CODES.map((code) => ({ value: code, label: t(REJECT_REASON_LABEL_KEYS[code]) })),
        ]}
      />
      <div>
        <SubmitButton variant="danger" pendingLabel={t("integrations.reject.pending")}>
          {t("integrations.reject.submit")}
        </SubmitButton>
      </div>
    </form>
  );
}
