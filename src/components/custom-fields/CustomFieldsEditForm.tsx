"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormActions, FormNotices, FormSection } from "@/components/records/FormShell";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { linkButtonReset } from "@/components/ui/linkButton";
import { useT } from "@/i18n/client";
import type { LoadedCustomFieldValue } from "@/domain/custom-fields/values";
import { CustomFieldInputs, type CustomFieldOption } from "./CustomFieldInputs";

export interface CustomFieldsSaveState {
  error?: string;
  field?: string;
}

/**
 * The standalone "edit custom fields" form used by claims and denials
 * (docs/specs/record-pages.md; docs/specs/settings-and-custom-fields.md S2 PR3). This form saves
 * only `custom_field_values` — it never touches the claim/denial row itself (custom fields are
 * practice-internal, not billed content, so saving them creates no `claim_versions` row) — so it
 * carries its own concurrency token (`expectedValuesToken`, from `customFieldValuesToken` in the
 * domain) rather than the record's own `updatedAt`.
 */
export function CustomFieldsEditForm({
  action,
  recordIdName,
  recordId,
  expectedValuesToken,
  fields,
  values,
  cancelHref,
}: {
  action: (state: CustomFieldsSaveState, formData: FormData) => Promise<CustomFieldsSaveState>;
  /** The hidden field name the server action reads the record id from ("claimId" / "denialId"). */
  recordIdName: string;
  recordId: string;
  expectedValuesToken: string;
  fields: CustomFieldOption[];
  values: LoadedCustomFieldValue[];
  cancelHref: string;
}) {
  const tcf = useT("customFields");
  const tc = useT("common");
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="flex flex-col" aria-label={tcf("section.title")}>
      <input type="hidden" name={recordIdName} value={recordId} />
      <input type="hidden" name="expectedValuesToken" value={expectedValuesToken} />
      <FormNotices>
        <FormAlert message={state.error} />
      </FormNotices>
      <FormSection title={tcf("section.title")}>
        <CustomFieldInputs
          bare
          fields={fields}
          values={values}
          errorFor={(key) => (state.field === `cf.${key}` ? state.error : undefined)}
        />
      </FormSection>
      <FormActions>
        <Button type="submit" variant="primary" disabled={pending} aria-disabled={pending}>
          {pending ? tc("action.saving") : tc("action.save")}
        </Button>
        <Link href={cancelHref} className={linkButtonReset}>
          {tc("action.cancel")}
        </Link>
      </FormActions>
    </form>
  );
}
