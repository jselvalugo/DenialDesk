"use client";

import Link from "next/link";
import { startTransition, useActionState } from "react";
import { FormActions, FormNotices, FormSection } from "@/components/records/FormShell";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { linkButtonReset } from "@/components/ui/linkButton";
import { TextField } from "@/components/ui/TextField";
import { useT } from "@/i18n/client";
import { saveLocationPlaceOfServiceAction } from "./actions";
import type { BillingFormState } from "./form-state";

/** Edit one location's place of service code (docs/specs/claims.md C3a-S), inside `<Panel flush>`. Format only. */
export function LocationPosForm({ id, placeOfService }: { id: string; placeOfService: string | null }) {
  const t = useT("settings");
  const tc = useT("common");
  const [state, action, pending] = useActionState<BillingFormState, FormData>(
    saveLocationPlaceOfServiceAction,
    {},
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => action(formData));
      }}
      className="flex flex-col"
      noValidate
    >
      <input type="hidden" name="id" value={id} />
      <FormNotices>
        <FormAlert message={state.fieldErrors ? undefined : state.error} id="billing-error" />
      </FormNotices>
      <FormSection title={t("billing.section.pos.title")} description={t("billing.section.pos.description")}>
        <TextField
          label={t("billing.form.pos")}
          name="placeOfService"
          defaultValue={placeOfService ?? ""}
          inputMode="numeric"
          maxLength={2}
          required
          className="w-24 font-mono"
          hint={t("billing.form.posHint")}
          error={state.fieldErrors?.placeOfService}
        />
      </FormSection>
      <FormActions>
        <Button type="submit" variant="primary" disabled={pending} aria-disabled={pending}>
          {pending ? t("billing.form.saving") : t("billing.form.save")}
        </Button>
        <Link href="/settings/billing" className={linkButtonReset}>
          {tc("action.cancel")}
        </Link>
      </FormActions>
    </form>
  );
}
