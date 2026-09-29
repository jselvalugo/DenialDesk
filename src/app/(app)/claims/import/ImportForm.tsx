"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { FormActions, FormNotices, FormSection } from "@/components/records/FormShell";
import { FormAlert } from "@/components/ui/FormAlert";
import { linkButtonReset, primaryLinkButtonClass } from "@/components/ui/linkButton";
import { SelectField } from "@/components/ui/SelectField";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useFormat, useT } from "@/i18n/client";
import { csvCell } from "@/lib/csv/parse";
import { importCharges, type ImportProblemRow, type ImportState } from "./actions";

interface Option {
  id: string;
  label: string;
}

/** Limits and display settings from the server, so this client bundle imports no domain code. */
export interface ImportLimits {
  megabytes: number;
  rows: number;
  /** Problems listed on the page; the report holds up to `reportProblems`. */
  shownProblems: number;
  reportProblems: number;
  warningDays: number;
}

/** Report of what to fix: row numbers, header names, codes, and fixed sentences; never a cell value. */
function reportCsv(problems: ImportProblemRow[]): string {
  const lines = ["Row,Column,Code,Message"];
  for (const p of problems) lines.push([p.row, p.column, p.code, p.message].map(csvCell).join(","));
  // The byte-order mark lets spreadsheets read the Spanish and Portuguese messages as UTF-8.
  return `﻿${lines.join("\r\n")}\r\n`;
}

function downloadReport(problems: ImportProblemRow[]) {
  const url = URL.createObjectURL(new Blob([reportCsv(problems)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "charge-import-report.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function ImportForm(props: {
  providers: Option[];
  locations: Option[];
  syntheticOnly: boolean;
  limits: ImportLimits;
}) {
  // Bumping the key gives "Import another file" a fresh form and a fresh action state.
  const [attempt, setAttempt] = useState(0);
  return <ImportFormBody key={attempt} {...props} onAgain={() => setAttempt((n) => n + 1)} />;
}

function ImportFormBody({
  providers,
  locations,
  syntheticOnly,
  limits,
  onAgain,
}: {
  providers: Option[];
  locations: Option[];
  syntheticOnly: boolean;
  limits: ImportLimits;
  onAgain: () => void;
}) {
  const [state, action] = useActionState<ImportState, FormData>(importCharges, {});
  const t = useT("claims");
  const tc = useT("common");
  const f = useFormat();

  if (state.result) {
    const { claims, lines, billedCents, warnings } = state.result;
    const notes = [
      warnings.pastDeadline > 0 && t("import.result.pastDeadline", { count: warnings.pastDeadline }),
      warnings.dueSoon > 0 &&
        t("import.result.dueSoon", { count: warnings.dueSoon, days: limits.warningDays }),
      warnings.notConfigured > 0 && t("import.result.notConfigured", { count: warnings.notConfigured }),
      warnings.payerUnverified > 0 && t("import.result.payerUnverified", { count: warnings.payerUnverified }),
      warnings.noCoverage > 0 && t("import.result.noCoverage", { count: warnings.noCoverage }),
      warnings.patientInactive > 0 && t("import.result.patientInactive", { count: warnings.patientInactive }),
    ].filter((note): note is string => typeof note === "string");
    return (
      <div className="flex flex-col gap-4 px-5 py-5" role="status">
        <h2 className="text-heading font-semibold text-text">{t("import.result.title")}</h2>
        <p className="text-body text-text">
          {t("import.result.summary", { claims, lines, billed: f.cents(billedCents) })}
        </p>
        <div>
          <h3 className="text-label font-semibold text-text">{t("import.result.warningsTitle")}</h3>
          {notes.length === 0 ? (
            <p className="mt-1 text-body text-muted">{t("import.result.noWarnings")}</p>
          ) : (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-body text-warning-fg">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/claims?group=unsubmitted" className={primaryLinkButtonClass}>
            {t("import.result.viewClaims")}
          </Link>
          {warnings.pastDeadline > 0 && (
            <Link href="/claims?group=unsubmitted&filing=past_deadline" className={linkButtonReset}>
              {t("import.result.viewPastDeadline")}
            </Link>
          )}
          <button type="button" onClick={onAgain} className={linkButtonReset}>
            {t("import.result.another")}
          </button>
        </div>
      </div>
    );
  }

  const problems = state.problems ?? [];
  const total = state.totalProblems ?? problems.length;
  return (
    <form action={action} className="flex flex-col" aria-label={t("import.title")}>
      <FormNotices>
        <FormAlert message={state.error} />
        {problems.length > 0 && (
          <div className="flex flex-col gap-2">
            <ul
              aria-label={t("import.problems.aria")}
              className="list-disc space-y-0.5 pl-5 text-body text-danger-fg"
            >
              {problems.slice(0, limits.shownProblems).map((p, i) => (
                <li key={`${p.row}-${p.code}-${i}`}>
                  {t("import.problems.row", { row: p.row, message: p.message })}
                </li>
              ))}
            </ul>
            {total > limits.shownProblems && (
              <p className="text-label text-muted">
                {t("import.problems.showing", {
                  shown: f.number(limits.shownProblems),
                  total: f.number(total),
                })}
              </p>
            )}
            <div>
              <button
                type="button"
                onClick={() => downloadReport(problems)}
                className="inline-flex h-8 items-center rounded-control border border-border-strong bg-surface px-3 text-body font-medium text-text hover:bg-surface-muted"
              >
                {t("import.problems.download")}
              </button>
              {total > limits.reportProblems && (
                <p className="mt-1 text-label text-muted">
                  {t("import.problems.truncated", {
                    limit: f.number(limits.reportProblems),
                    more: f.number(total - limits.reportProblems),
                  })}
                </p>
              )}
            </div>
          </div>
        )}
      </FormNotices>
      <FormSection
        title={t("import.file.title")}
        description={t("import.file.description", { size: limits.megabytes, rows: f.number(limits.rows) })}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="file" className="text-label font-medium text-text">
            {t("import.file.label")}
          </label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            aria-describedby="file-hint"
            className="text-body text-text file:mr-3 file:h-8 file:rounded-control file:border file:border-border-strong file:bg-surface file:px-3 file:text-body file:font-medium file:text-text hover:file:bg-surface-muted"
          />
          <p id="file-hint" className="text-label text-muted">
            {t("import.file.hint")}
          </p>
        </div>
      </FormSection>
      <FormSection title={t("import.defaults.title")} description={t("import.defaults.description")}>
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label={t("import.defaults.provider")}
            name="providerId"
            required
            defaultValue={providers.length === 1 ? providers[0]!.id : ""}
            options={[
              ...(providers.length === 1 ? [] : [{ value: "", label: t("import.defaults.choose") }]),
              ...providers.map((p) => ({ value: p.id, label: p.label })),
            ]}
          />
          <SelectField
            label={t("import.defaults.location")}
            name="locationId"
            required
            defaultValue={locations.length === 1 ? locations[0]!.id : ""}
            options={[
              ...(locations.length === 1 ? [] : [{ value: "", label: t("import.defaults.choose") }]),
              ...locations.map((l) => ({ value: l.id, label: l.label })),
            ]}
          />
        </div>
      </FormSection>
      {syntheticOnly && (
        <FormSection title={t("import.synthetic.title")} description={t("import.synthetic.description")}>
          <label className="flex items-start gap-2 text-body text-text">
            <input type="checkbox" name="syntheticAttestation" required className="mt-0.5 size-4" />
            <span>{t("import.synthetic.attestation")}</span>
          </label>
        </FormSection>
      )}
      <FormActions note={t("import.auditNote")}>
        <SubmitButton variant="primary" pendingLabel={t("import.submitting")}>
          {t("import.submit")}
        </SubmitButton>
        <Link href="/claims" className={linkButtonReset}>
          {tc("action.cancel")}
        </Link>
      </FormActions>
    </form>
  );
}
