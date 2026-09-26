"use client";

import Link from "next/link";
import { startTransition, useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { TextField } from "@/components/ui/TextField";
import { SENSITIVITY_TAGS, SEX_LABELS } from "@/domain/patients/record";
import { registerPatient, savePatient, type PatientFormState } from "./actions";

const selectClass =
  "h-9 rounded-control border border-border-strong bg-surface px-2.5 text-body text-text focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus";

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

/** Register (no `patient`) or edit a patient record (docs/specs/patients.md). */
export function PatientForm({
  patient,
  payers,
  canTag,
  syntheticOnly,
  today,
}: {
  patient?: PatientFormValues;
  payers: Array<{ id: string; name: string }>;
  canTag: boolean;
  syntheticOnly: boolean;
  today: string;
}) {
  const editing = Boolean(patient);
  const [state, action, pending] = useActionState<PatientFormState, FormData>(
    editing ? savePatient : registerPatient,
    {},
  );
  const err = (field: string) => (state.field === field ? state.error : undefined);

  return (
    // Submitted via onSubmit (not the action prop) so React keeps the typed values when the server
    // rejects them.
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => action(formData));
      }}
      className="flex flex-col gap-6"
      aria-label={editing ? "Edit patient" : "Register patient"}
      autoComplete="off"
    >
      {patient && (
        <>
          <input type="hidden" name="patientId" value={patient.id} />
          <input type="hidden" name="expectedUpdatedAt" value={patient.updatedAt} />
        </>
      )}
      <FormAlert message={state.error} />
      {syntheticOnly && (
        <p role="note" className="rounded-control bg-warning-bg px-3 py-2 text-label text-warning-fg">
          Synthetic data only. Never enter a real patient here; MRNs and member IDs must start with SYN.
        </p>
      )}

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-heading font-semibold text-text">Demographics</legend>
        <div className="grid grid-cols-3 gap-4">
          <TextField
            label="Last name"
            name="lastName"
            required
            maxLength={60}
            defaultValue={patient?.lastName}
            error={err("lastName")}
          />
          <TextField
            label="First name"
            name="firstName"
            required
            maxLength={60}
            defaultValue={patient?.firstName}
            error={err("firstName")}
          />
          <TextField
            label="MRN"
            name="mrn"
            maxLength={40}
            defaultValue={patient?.mrn}
            hint={editing ? undefined : "Leave blank to assign the next number."}
            error={err("mrn")}
            className="font-mono"
          />
          <TextField
            label="Date of birth"
            name="birthDate"
            type="date"
            required
            min="1900-01-01"
            max={today}
            defaultValue={patient?.birthDate}
            error={err("birthDate")}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="field-sex" className="text-label font-medium text-text">
              Sex
            </label>
            <select id="field-sex" name="sex" defaultValue={patient?.sex ?? "U"} className={selectClass}>
              {Object.entries(SEX_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <TextField
            label="Phone"
            name="phone"
            type="tel"
            maxLength={20}
            defaultValue={patient?.phone ?? ""}
            error={err("phone")}
          />
        </div>
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_80px_120px] gap-4">
          <TextField
            label="Address"
            name="addressLine1"
            maxLength={100}
            defaultValue={patient?.addressLine1 ?? ""}
            error={err("addressLine1")}
          />
          <TextField
            label="City"
            name="city"
            maxLength={60}
            defaultValue={patient?.city ?? ""}
            error={err("city")}
          />
          <TextField
            label="State"
            name="state"
            maxLength={2}
            defaultValue={patient?.state ?? "FL"}
            error={err("state")}
          />
          <TextField
            label="ZIP"
            name="postalCode"
            maxLength={10}
            inputMode="numeric"
            defaultValue={patient?.postalCode ?? ""}
            error={err("postalCode")}
          />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-heading font-semibold text-text">Primary insurance</legend>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="field-primaryPayerId" className="text-label font-medium text-text">
              Payer
            </label>
            <select
              id="field-primaryPayerId"
              name="primaryPayerId"
              defaultValue={patient?.primaryPayerId ?? ""}
              aria-invalid={state.field === "primaryPayerId" || undefined}
              className={selectClass}
            >
              <option value="">No insurance on file (self-pay)</option>
              {payers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {state.field === "primaryPayerId" && (
              <p className="text-label font-medium text-danger-fg">{state.error}</p>
            )}
          </div>
          <TextField
            label="Member ID"
            name="memberId"
            maxLength={30}
            className="font-mono"
            hint={
              patient?.memberIdLast4
                ? `On file: •••• ${patient.memberIdLast4}. Leave blank to keep it.`
                : "Stored encrypted; only the last 4 are shown."
            }
            error={err("memberId")}
          />
        </div>
      </fieldset>

      {canTag ? (
        <fieldset>
          <legend className="mb-1 text-heading font-semibold text-text">Sensitivity</legend>
          <p className="mb-3 text-label text-muted">
            Tags mark records that need stricter access and masking under Florida and federal law.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(SENSITIVITY_TAGS).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-body text-text">
                <input
                  type="checkbox"
                  name="sensitivityTags"
                  value={value}
                  defaultChecked={patient?.sensitivityTags.includes(value)}
                  className="size-4 accent-primary"
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        // Non-administrators keep whatever tags are stored (the server ignores their input).
        patient?.sensitivityTags.map((tag) => (
          <input key={tag} type="hidden" name="sensitivityTags" value={tag} />
        ))
      )}

      {editing && (
        <label className="flex flex-col gap-1.5 text-label font-medium text-text">
          Reason for the change (required, saved in the audit trail)
          <textarea
            name="reason"
            required
            minLength={5}
            maxLength={500}
            rows={2}
            aria-invalid={state.field === "reason" || undefined}
            className="rounded-control border border-border-strong bg-surface px-3 py-2 text-body text-text focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus"
          />
          <span className="font-normal text-muted">Don&apos;t put patient details in the reason.</span>
        </label>
      )}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending} aria-disabled={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Register patient"}
        </Button>
        <Link
          href={patient ? `/patients/${patient.id}` : "/patients"}
          className="inline-flex h-8 items-center rounded-control px-3 text-body font-medium text-muted hover:bg-surface-muted hover:text-text"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
