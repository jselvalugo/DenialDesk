"use client";

import { useActionState, useEffect, useRef } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { Select } from "@/components/ui/Select";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import { useT } from "@/i18n/client";
import { voidAgreement, type VoidAgreementState } from "../../actions";

/** Marks one of the practice's agreements as recorded in error; it stays on file, no longer counted. */
export function VoidAgreementForm({
  tenantId,
  agreements,
}: {
  tenantId: string;
  agreements: Array<{ id: string; label: string }>;
}) {
  const [state, action] = useActionState<VoidAgreementState, FormData>(voidAgreement, {});
  const formRef = useRef<HTMLFormElement>(null);
  const t = useT("operator");
  useEffect(() => {
    if (state.voided) formRef.current?.reset();
  }, [state]);

  return (
    <div className="flex flex-col gap-4">
      {state.voided && (
        <p
          role="status"
          className="rounded-panel border border-success-border bg-success-bg p-3 text-body text-success-fg"
        >
          {t("voidForm.recordedNotice")}
        </p>
      )}
      <form ref={formRef} action={action} className="flex flex-col gap-4">
        <input type="hidden" name="tenantId" value={tenantId} />
        <FormAlert message={state.error} />
        <Select
          label={t("voidForm.agreementLabel")}
          name="agreementId"
          options={[
            { value: "", label: t("voidForm.choosePlaceholder") },
            ...agreements.map((a) => ({ value: a.id, label: a.label })),
          ]}
          required
        />
        <TextField
          label={t("voidForm.reasonLabel")}
          name="reason"
          required
          minLength={5}
          maxLength={500}
          hint={t("voidForm.reasonHint")}
        />
        <div>
          <SubmitButton variant="danger" pendingLabel={t("voidForm.marking")}>
            {t("voidForm.submit")}
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
