"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { SearchInput } from "@/components/ui/SearchInput";
import { TableToolbar } from "@/components/ui/TableToolbar";
import { useT } from "@/i18n/client";
import { findPatients, type SearchState } from "./actions";
import { PatientTable } from "./PatientTable";

/**
 * The list toolbar: search runs as a POST server action, so names and MRNs never appear in the URL
 * (CLAUDE.md #4). Results replace nothing; they render in their own labelled region above the list.
 */
export function PatientSearch({ summary, today }: { summary: string; today: string }) {
  const [state, action, pending] = useActionState<SearchState, FormData>(findPatients, {});
  const t = useT("patients");
  const tc = useT("common");
  const count = state.results?.length ?? 0;
  return (
    <div className="flex flex-col">
      <TableToolbar as="form" action={action} role="search" summary={summary}>
        <SearchInput
          id="patient-search"
          label={t("search.label")}
          name="q"
          minLength={2}
          maxLength={100}
          required
          placeholder={t("search.placeholder")}
          hint={t("list.searchHint")}
          className="w-80"
        />
        <Button type="submit" disabled={pending} aria-disabled={pending}>
          {pending ? t("search.searching") : tc("action.search")}
        </Button>
      </TableToolbar>
      {state.error && (
        <div className="px-4 pt-3">
          <FormAlert message={state.error} />
        </div>
      )}
      {state.results && (
        <section aria-label={t("search.resultsLabel")} className="border-b border-border">
          <p role="status" className="bg-selected px-4 py-2 text-label font-medium text-text">
            {count === 0
              ? t("search.noMatches")
              : `${t("search.matchCount", { count })}${count >= 25 ? ` ${t("search.truncatedHint")}` : ""}.`}
          </p>
          {count > 0 && (
            <PatientTable rows={state.results!} caption={t("search.resultsCaption")} today={today} />
          )}
        </section>
      )}
    </div>
  );
}
