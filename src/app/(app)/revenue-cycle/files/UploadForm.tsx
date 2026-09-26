"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { Select } from "@/components/ui/Select";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { uploadMonthlyFile, type UploadState } from "./actions";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function UploadForm({
  sites,
  defaultYear,
  defaultMonth,
  syntheticOnly,
}: {
  sites: { id: string; code: string; name: string }[];
  defaultYear: number;
  defaultMonth: number;
  syntheticOnly: boolean;
}) {
  const [state, action] = useActionState<UploadState, FormData>(uploadMonthlyFile, {});
  const years = [defaultYear - 1, defaultYear, defaultYear + 1];
  return (
    <form action={action} className="flex max-w-[720px] flex-col gap-4">
      <FormAlert message={state.error} />
      {state.problems && state.problems.length > 0 && (
        <ul aria-label="Problems in the file" className="list-disc space-y-0.5 pl-5 text-body text-danger-fg">
          {state.problems.map((p) => (
            <li key={`${p.row}-${p.message}`}>
              Row {p.row}: {p.message}
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Select
          label="Month"
          name="periodMonth"
          defaultValue={String(defaultMonth)}
          options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
        />
        <Select
          label="Year"
          name="periodYear"
          defaultValue={String(defaultYear)}
          options={years.map((y) => ({ value: String(y), label: String(y) }))}
        />
      </div>
      <Select
        label="Site for lines whose facility doesn't name a site"
        name="defaultSiteId"
        defaultValue=""
        options={[
          { value: "", label: "No site" },
          ...sites.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })),
        ]}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="file" className="text-label font-medium text-text">
          Monthly file (CSV, up to 5 MB)
        </label>
        <input
          id="file"
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className="text-body text-text file:mr-3 file:h-8 file:rounded-control file:border file:border-border-strong file:bg-surface file:px-3 file:text-body file:font-medium file:text-text hover:file:bg-surface-muted"
        />
      </div>
      {syntheticOnly && (
        <label className="flex items-start gap-2 text-body text-text">
          <input type="checkbox" name="syntheticAttestation" required className="mt-0.5 size-4" />
          <span>
            This file contains synthetic data only. Every account number starts with <code>SYN-</code>; real
            patient files are rejected in this environment.
          </span>
        </label>
      )}
      <div>
        <SubmitButton variant="primary" pendingLabel="Importing…">
          Import file
        </SubmitButton>
      </div>
    </form>
  );
}
