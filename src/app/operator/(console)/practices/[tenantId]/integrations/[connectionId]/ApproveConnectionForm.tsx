"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { SelectField } from "@/components/ui/SelectField";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import {
  APPROVAL_METHOD_CODES,
  APPROVAL_METHOD_LABEL_KEYS,
  CONTACT_ROLE_CODES,
  CONTACT_ROLE_LABEL_KEYS,
  POPULATION_SCOPES,
  POPULATION_SCOPE_LABEL_KEYS,
} from "@/domain/integrations/approval-codes";
import { useT } from "@/i18n/client";
import { approveIntegration, type IntegrationDecisionState } from "../../../../actions";

/**
 * Approve a submitted connection (docs/specs/patient-integrations.md PI1c): how it was verified with
 * the practice's EHR administrator, when, the contact's role (never a name), the population scope,
 * optionally that MRNs have nine numerals, and the operator's confirmation that the practice owns the
 * client ID, verified outside the app. Every field is checked again on the server.
 */
export function ApproveConnectionForm({
  tenantId,
  connectionId,
  updatedAt,
  clientId,
  today,
  minDate,
}: {
  tenantId: string;
  connectionId: string;
  updatedAt: string;
  clientId: string;
  /** The console's "today" (YYYY-MM-DD), the latest date the verification can carry. */
  today: string;
  /** The Florida date the practice submitted the connection (YYYY-MM-DD): the earliest verification date. */
  minDate: string;
}) {
  const [state, action] = useActionState<IntegrationDecisionState, FormData>(approveIntegration, {});
  const t = useT("operator");
  const choose = { value: "", label: t("integrations.choose") };

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="connectionId" value={connectionId} />
      <input type="hidden" name="updatedAt" value={updatedAt} />
      <FormAlert message={state.error} />
      <SelectField
        label={t("integrations.approve.methodLabel")}
        name="methodCode"
        id="approve-method"
        required
        options={[
          choose,
          ...APPROVAL_METHOD_CODES.map((code) => ({
            value: code,
            label: t(APPROVAL_METHOD_LABEL_KEYS[code]),
          })),
        ]}
      />
      <TextField
        label={t("integrations.approve.dateLabel")}
        name="verifiedOn"
        id="approve-date"
        type="date"
        min={minDate}
        max={today}
        required
        hint={t("integrations.approve.dateHint")}
      />
      <SelectField
        label={t("integrations.approve.roleLabel")}
        name="contactRole"
        id="approve-role"
        required
        hint={t("integrations.approve.roleHint")}
        options={[
          choose,
          ...CONTACT_ROLE_CODES.map((code) => ({ value: code, label: t(CONTACT_ROLE_LABEL_KEYS[code]) })),
        ]}
      />
      <SelectField
        label={t("integrations.approve.scopeLabel")}
        name="populationScope"
        id="approve-scope"
        required
        hint={t("integrations.approve.scopeHint")}
        options={[
          choose,
          ...POPULATION_SCOPES.map((scope) => ({
            value: scope,
            // Only a Group export can be approved for now; the server refuses the other.
            label:
              scope === "group_export"
                ? t(POPULATION_SCOPE_LABEL_KEYS[scope])
                : `${t(POPULATION_SCOPE_LABEL_KEYS[scope])} (${t("integrations.scope.notYet")})`,
          })),
        ]}
      />
      <div className="flex flex-col gap-1">
        <label className="flex items-start gap-2 text-body text-text">
          <input type="checkbox" name="mrnNineDigits" className="mt-0.5 size-4" />
          <span>{t("integrations.approve.nineDigitsLabel")}</span>
        </label>
        <p className="ml-6 text-label text-muted">{t("integrations.approve.nineDigitsHint")}</p>
      </div>
      <div className="flex flex-col gap-1">
        <label className="flex items-start gap-2 text-body text-text">
          <input type="checkbox" name="clientIdOwnership" required className="mt-0.5 size-4" />
          <span>{t("integrations.approve.ownershipLabel", { clientId })}</span>
        </label>
        <p className="ml-6 text-label text-muted">{t("integrations.approve.ownershipHint")}</p>
      </div>
      <div>
        <SubmitButton variant="primary" pendingLabel={t("integrations.approve.pending")}>
          {t("integrations.approve.submit")}
        </SubmitButton>
      </div>
    </form>
  );
}
