"use client";

import { useActionState } from "react";
import { FormAlert } from "@/components/ui/FormAlert";
import { Select } from "@/components/ui/Select";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/messages/types";
import { uploadMonthlyFile, type UploadState } from "./actions";

const MONTH_KEYS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
] as const;

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
  const t = useT("revenue");
  const [state, action] = useActionState<UploadState, FormData>(uploadMonthlyFile, {});
  const years = [defaultYear - 1, defaultYear, defaultYear + 1];
  return (
    <form action={action} className="flex max-w-[720px] flex-col gap-4">
      <FormAlert message={state.error} />
      {state.problems && state.problems.length > 0 && (
        <ul
          aria-label={t("deposits.problemsAria")}
          className="list-disc space-y-0.5 pl-5 text-body text-danger-fg"
        >
          {state.problems.map((p) => (
            <li key={`${p.row}-${p.message}`}>
              {t("deposits.rowProblem", { row: p.row, message: p.message })}
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Select
          label={t("files.form.month")}
          name="periodMonth"
          defaultValue={String(defaultMonth)}
          options={MONTH_KEYS.map((key, i) => ({
            value: String(i + 1),
            label: t(("files.month." + key) as MessageKey<"revenue">),
          }))}
        />
        <Select
          label={t("files.form.year")}
          name="periodYear"
          defaultValue={String(defaultYear)}
          options={years.map((y) => ({ value: String(y), label: String(y) }))}
        />
      </div>
      <Select
        label={t("files.form.defaultSite")}
        name="defaultSiteId"
        defaultValue=""
        options={[
          { value: "", label: t("files.form.noSite") },
          ...sites.map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })),
        ]}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="file" className="text-label font-medium text-text">
          {t("files.form.fileLabel")}
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
            {t("files.form.syntheticAttestation.prefix")} <code>SYN-</code>
            {t("files.form.syntheticAttestation.suffix")}
          </span>
        </label>
      )}
      <div>
        <SubmitButton variant="primary" pendingLabel={t("files.importing")}>
          {t("files.importAction")}
        </SubmitButton>
      </div>
    </form>
  );
}
