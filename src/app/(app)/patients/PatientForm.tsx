"use client";

import Link from "next/link";
import { startTransition, useActionState, useId, useMemo, useState } from "react";
import { FormActions, FormNotices, FormRow, FormSection } from "@/components/records/FormShell";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { linkButtonReset } from "@/components/ui/linkButton";
import { SelectField } from "@/components/ui/SelectField";
import { TextareaField } from "@/components/ui/TextareaField";
import { TextField } from "@/components/ui/TextField";
import { useT } from "@/i18n/client";
import { SEX_LABEL_KEYS, sexLabel } from "@/domain/patients/record";
import { resolvePayerByName, type PayerOption } from "@/domain/payers/resolve";
import { registerPatient, savePatient, type PatientFormState } from "./actions";

const inputClass =
  "h-9 rounded-control border border-border-strong bg-surface px-3 text-body text-text placeholder:text-subtle focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus";

const SELF_PAY = "";

/**
 * Searchable payer picker: a text input filtered against `<datalist>` (no new dependency), backed
 * by a hidden field carrying the payer id the server expects. Resolution is a pure function
 * (`resolvePayerByName`, unit-tested): empty text is self-pay, text matching one or more payers
 * (by trimmed, case-insensitive name — preferring a verified one when names collide) uses that
 * payer, and text matching nothing is a blocking field error — it must never silently fall back to
 * self-pay, and the hidden id is left at its last valid value while the error is showing.
 */
function PayerPicker({
  payers,
  defaultPayerId,
  invalid,
  onValidityChange,
}: {
  payers: PayerOption[];
  defaultPayerId: string;
  invalid: boolean;
  onValidityChange: (valid: boolean) => void;
}) {
  const t = useT("patients");
  const tc = useT("common");
  const listId = useId();
  const initial = useMemo(() => payers.find((p) => p.id === defaultPayerId), [payers, defaultPayerId]);
  const [text, setText] = useState(initial?.name ?? "");
  const [payerId, setPayerId] = useState(defaultPayerId);
  const resolution = useMemo(() => resolvePayerByName(payers, text), [payers, text]);

  const unverifiedHintId = `${listId}-unverified`;
  const errorId = `${listId}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="field-primaryPayer" className="text-label font-medium text-text">
        {tc("word.payer")}
      </label>
      <input
        id="field-primaryPayer"
        type="text"
        list={listId}
        value={text}
        placeholder={t("form.payerPlaceholder")}
        aria-invalid={invalid || resolution.status === "unmatched" || undefined}
        aria-describedby={
          resolution.status === "unmatched"
            ? errorId
            : resolution.status === "matched" && !resolution.payer.verified
              ? unverifiedHintId
              : undefined
        }
        onChange={(event) => {
          const value = event.target.value;
          setText(value);
          // Only a resolvable value (self-pay or a matched payer) updates the id the server
          // receives; unmatched text leaves it at its last valid value rather than reverting to
          // self-pay, and blocks submit via `onValidityChange` until it's fixed.
          const next = resolvePayerByName(payers, value);
          if (next.status === "self_pay") setPayerId(SELF_PAY);
          else if (next.status === "matched") setPayerId(next.payer.id);
          onValidityChange(next.status !== "unmatched");
        }}
        className={inputClass}
      />
      <datalist id={listId}>
        {payers.map((p) => (
          <option
            key={p.id}
            value={p.name}
            label={p.verified ? p.name : t("form.payerUnverifiedOption", { name: p.name })}
          />
        ))}
      </datalist>
      {resolution.status === "unmatched" && (
        <p id={errorId} className="text-label font-medium text-danger-fg">
          {t("form.payerNoMatch", { query: text.trim() })}
        </p>
      )}
      {resolution.status === "matched" && !resolution.payer.verified && (
        <p id={unverifiedHintId} className="text-label text-muted">
          {t("form.payerUnverifiedHint")}
        </p>
      )}
      <input type="hidden" name="primaryPayerId" value={payerId} />
    </div>
  );
}

export interface PatientFormValues {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  sex: "F" | "M" | "U";
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  primaryPayerId: string | null;
  memberIdLast4: string;
  sensitivityTags: string[];
  updatedAt: string;
}

/**
 * Register (no `patient`) or edit a patient record (docs/specs/patients.md), laid out as named
 * sections per the record pattern (docs/specs/record-pages.md). Rendered inside `<Panel flush>`.
 */
export function PatientForm({
  patient,
  payers,
  syntheticOnly,
  today,
}: {
  patient?: PatientFormValues;
  payers: PayerOption[];
  syntheticOnly: boolean;
  today: string;
}) {
  const t = useT("patients");
  const tc = useT("common");
  const editing = Boolean(patient);
  const [state, action, pending] = useActionState<PatientFormState, FormData>(
    editing ? savePatient : registerPatient,
    {},
  );
  const err = (field: string) => (state.field === field ? state.error : undefined);
  const [payerValid, setPayerValid] = useState(true);

  return (
    // Submitted via onSubmit (not the action prop) so React keeps the typed values when the server
    // rejects them.
    <form
      onSubmit={(event) => {
        event.preventDefault();
        // The payer picker's own field error blocks submission client-side: unmatched text must
        // never be silently sent as self-pay (spec: payer-catalog P1).
        if (!payerValid) return;
        const formData = new FormData(event.currentTarget);
        startTransition(() => action(formData));
      }}
      className="flex flex-col"
      aria-label={editing ? t("edit.title") : t("new.title")}
      autoComplete="off"
    >
      {patient && (
        <>
          <input type="hidden" name="patientId" value={patient.id} />
          <input type="hidden" name="expectedUpdatedAt" value={patient.updatedAt} />
        </>
      )}
      <FormNotices>
        <FormAlert message={state.error} />
        {syntheticOnly && (
          <p
            role="note"
            className="rounded-control border border-warning-border bg-warning-bg px-3 py-2 text-label text-warning-fg"
          >
            {t("form.syntheticNotice")}
          </p>
        )}
      </FormNotices>

      <FormSection title={t("detail.demographics")} description={t("form.demographicsHint")}>
        <FormRow columns="md:grid-cols-3">
          <TextField
            label={t("field.lastName")}
            name="lastName"
            required
            maxLength={60}
            defaultValue={patient?.lastName}
            error={err("lastName")}
          />
          <TextField
            label={t("field.firstName")}
            name="firstName"
            required
            maxLength={60}
            defaultValue={patient?.firstName}
            error={err("firstName")}
          />
          <TextField
            label={t("field.mrn")}
            name="mrn"
            maxLength={40}
            defaultValue={patient?.mrn}
            hint={editing ? undefined : t("form.mrnHint")}
            error={err("mrn")}
            className="font-mono"
          />
        </FormRow>
        <FormRow columns="md:grid-cols-3">
          <TextField
            label={t("field.birthDate")}
            name="birthDate"
            type="date"
            required
            min="1900-01-01"
            max={today}
            defaultValue={patient?.birthDate}
            error={err("birthDate")}
          />
          <SelectField
            label={t("field.sex")}
            name="sex"
            defaultValue={patient?.sex ?? "U"}
            error={err("sex")}
            options={(Object.keys(SEX_LABEL_KEYS) as (keyof typeof SEX_LABEL_KEYS)[]).map((value) => ({
              value,
              label: sexLabel(value, t),
            }))}
          />
          <TextField
            label={t("field.phone")}
            name="phone"
            type="tel"
            maxLength={20}
            defaultValue={patient?.phone ?? ""}
            error={err("phone")}
          />
        </FormRow>
        <FormRow columns="md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_80px_120px]">
          <TextField
            label={t("field.address")}
            name="addressLine1"
            maxLength={100}
            defaultValue={patient?.addressLine1 ?? ""}
            error={err("addressLine1")}
          />
          <TextField
            label={t("field.city")}
            name="city"
            maxLength={60}
            defaultValue={patient?.city ?? ""}
            error={err("city")}
          />
          <TextField
            label={t("field.state")}
            name="state"
            maxLength={2}
            defaultValue={patient?.state ?? "FL"}
            error={err("state")}
          />
          <TextField
            label={t("field.zip")}
            name="postalCode"
            maxLength={10}
            inputMode="numeric"
            defaultValue={patient?.postalCode ?? ""}
            error={err("postalCode")}
          />
        </FormRow>
      </FormSection>

      <FormSection title={t("detail.primaryInsurance")} description={t("form.insuranceHint")}>
        <FormRow columns="md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <PayerPicker
              payers={payers}
              defaultPayerId={patient?.primaryPayerId ?? ""}
              invalid={state.field === "primaryPayerId"}
              onValidityChange={setPayerValid}
            />
            {state.field === "primaryPayerId" && (
              <p className="text-label font-medium text-danger-fg">{state.error}</p>
            )}
          </div>
          <TextField
            label={t("field.memberId")}
            name="memberId"
            maxLength={30}
            className="font-mono"
            hint={
              patient?.memberIdLast4
                ? t("form.memberIdHintOnFile", { last4: patient.memberIdLast4 })
                : t("form.memberIdHintNew")
            }
            error={err("memberId")}
          />
        </FormRow>
      </FormSection>

      {/* Sensitivity checkboxes are hidden for now; stored tags are carried through unchanged. */}
      {patient?.sensitivityTags.map((tag) => (
        <input key={tag} type="hidden" name="sensitivityTags" value={tag} />
      ))}

      {editing && (
        <FormSection title={t("form.auditTitle")} description={t("form.auditHint")}>
          <TextareaField
            label={t("form.reasonLabel")}
            name="reason"
            required
            minLength={5}
            maxLength={500}
            rows={2}
            hint={t("form.reasonHint")}
            error={err("reason")}
          />
        </FormSection>
      )}

      {syntheticOnly && (
        <FormSection title={t("form.confirmTitle")} description={t("form.confirmHint")}>
          <label className="flex items-start gap-2 text-body text-text">
            <input
              type="checkbox"
              name="syntheticAttestation"
              required
              aria-invalid={state.field === "syntheticAttestation" || undefined}
              className="mt-0.5 size-4 accent-primary"
            />
            {t("form.syntheticAttestation")}
          </label>
        </FormSection>
      )}

      <FormActions note={editing ? t("form.actionsNote") : undefined}>
        <Button
          type="submit"
          variant="primary"
          disabled={pending || !payerValid}
          aria-disabled={pending || !payerValid}
        >
          {pending ? tc("action.saving") : editing ? t("form.saveChanges") : t("new.title")}
        </Button>
        <Link href={patient ? `/patients/${patient.id}` : "/patients"} className={linkButtonReset}>
          {tc("action.cancel")}
        </Link>
      </FormActions>
    </form>
  );
}
