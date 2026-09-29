"use client";

import Link from "next/link";
import { startTransition, useActionState } from "react";
import { StepUpLink } from "@/components/auth/StepUpLink";
import { FormActions, FormNotices, FormRow, FormSection } from "@/components/records/FormShell";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { linkButtonReset } from "@/components/ui/linkButton";
import { SelectField } from "@/components/ui/SelectField";
import { TextField } from "@/components/ui/TextField";
import { useT } from "@/i18n/client";
import { BILLING_LIMITS } from "@/domain/settings/billing-limits";
import { saveProviderBillingAction } from "./actions";
import type { BillingFormState } from "./form-state";

export interface ProviderBillingValues {
  id: string;
  firstName: string;
  lastName: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  tinType: "EI" | "SY" | null;
  /** Last four digits, "unreadable", or null. The TIN itself never reaches this component. */
  tinLast4: string | null;
}

/**
 * Edit one provider's billing details (docs/specs/claims.md C3a-S), rendered inside `<Panel flush>`. The TIN is
 * write-only: its input is always empty and masked, and only the last four digits of the stored one are shown.
 * `needsStepUp` shows the verify link up front; the server refuses a TIN change without a recent MFA anyway.
 */
export function ProviderBillingForm({
  provider,
  needsStepUp,
}: {
  provider: ProviderBillingValues;
  needsStepUp: boolean;
}) {
  const t = useT("settings");
  const tc = useT("common");
  const [state, action, pending] = useActionState<BillingFormState, FormData>(saveProviderBillingAction, {});
  const error = (name: keyof NonNullable<BillingFormState["fieldErrors"]>) => state.fieldErrors?.[name];
  const tinHint =
    provider.tinLast4 === null
      ? t("billing.form.tinHintNone")
      : provider.tinLast4 === "unreadable"
        ? t("billing.form.tinHintUnreadable")
        : t("billing.form.tinHintOnFile", { last4: provider.tinLast4 });

  return (
    // Submitted via onSubmit (not the action prop) so React keeps the typed values when the server refuses them.
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        // The TIN is write-only: it leaves the field as soon as it is sent, so a refused save (step-up,
        // validation) never leaves it sitting in the page.
        const tin = event.currentTarget.elements.namedItem("tin");
        if (tin instanceof HTMLInputElement) tin.value = "";
        startTransition(() => action(formData));
      }}
      className="flex flex-col"
      noValidate
      autoComplete="off"
    >
      <input type="hidden" name="id" value={provider.id} />
      <FormNotices>
        <FormAlert message={state.error} id="billing-error" />
        {(needsStepUp || state.stepUpRequired) && (
          <div className="flex flex-col items-start gap-1">
            <p className="text-body text-text">{t("billing.stepUp.notice")}</p>
            <StepUpLink label={t("billing.stepUp.link")} />
          </div>
        )}
      </FormNotices>
      <FormSection
        title={t("billing.section.name.title")}
        description={t("billing.section.name.description")}
      >
        <FormRow columns="md:grid-cols-2">
          <TextField
            label={t("billing.form.firstName")}
            name="firstName"
            defaultValue={provider.firstName}
            maxLength={BILLING_LIMITS.firstName + 20}
            required
            error={error("firstName")}
          />
          <TextField
            label={t("billing.form.lastName")}
            name="lastName"
            defaultValue={provider.lastName}
            maxLength={BILLING_LIMITS.lastName + 20}
            required
            error={error("lastName")}
          />
        </FormRow>
      </FormSection>
      <FormSection
        title={t("billing.section.address.title")}
        description={t("billing.section.address.description")}
      >
        <TextField
          label={t("billing.form.addressLine1")}
          name="addressLine1"
          defaultValue={provider.addressLine1}
          maxLength={BILLING_LIMITS.addressLine1 + 20}
          required
          error={error("addressLine1")}
        />
        <FormRow columns="md:grid-cols-[minmax(0,1fr)_120px_160px]">
          <TextField
            label={t("billing.form.city")}
            name="city"
            defaultValue={provider.city}
            maxLength={BILLING_LIMITS.city + 20}
            required
            error={error("city")}
          />
          <TextField
            label={t("billing.form.state")}
            name="state"
            defaultValue={provider.state}
            maxLength={2}
            required
            className="uppercase"
            error={error("state")}
          />
          <TextField
            label={t("billing.form.postalCode")}
            name="postalCode"
            defaultValue={provider.postalCode}
            inputMode="numeric"
            maxLength={10}
            required
            hint={t("billing.form.postalCodeHint")}
            error={error("postalCode")}
          />
        </FormRow>
      </FormSection>
      <FormSection title={t("billing.section.tin.title")} description={t("billing.section.tin.description")}>
        <FormRow columns="md:grid-cols-2">
          <SelectField
            label={t("billing.form.tinType")}
            name="tinType"
            defaultValue={provider.tinType ?? ""}
            options={[
              { value: "", label: t("billing.form.tinTypeNone") },
              { value: "EI", label: t("billing.form.tinTypeEI") },
              { value: "SY", label: t("billing.form.tinTypeSY") },
            ]}
            error={error("tinType")}
          />
          <TextField
            label={t("billing.form.tin")}
            name="tin"
            type="password"
            defaultValue=""
            autoComplete="off"
            inputMode="numeric"
            maxLength={20}
            className="font-mono"
            hint={tinHint}
            error={error("tin")}
          />
        </FormRow>
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
