"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { findPatients, type SearchState } from "./actions";
import { PatientTable } from "./PatientTable";

/** Search runs as a POST server action: names and MRNs never appear in the URL (CLAUDE.md #4). */
export function PatientSearch() {
  const [state, action, pending] = useActionState<SearchState, FormData>(findPatients, {});
  return (
    <div className="flex flex-col">
      <form action={action} role="search" className="flex items-end gap-2 border-b border-border px-4 py-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="patient-search" className="text-label font-medium text-muted">
            Find a patient
          </label>
          <input
            id="patient-search"
            name="q"
            type="search"
            minLength={2}
            maxLength={100}
            required
            autoComplete="off"
            placeholder="Last, First · name · MRN"
            className="h-8 w-80 rounded-control border border-border-strong bg-surface px-2.5 text-body text-text placeholder:text-subtle focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus"
          />
        </div>
        <Button type="submit" disabled={pending} aria-disabled={pending}>
          {pending ? "Searching…" : "Search"}
        </Button>
      </form>
      {state.error && (
        <div className="px-4 pt-3">
          <FormAlert message={state.error} />
        </div>
      )}
      {state.results && (
        <section aria-label="Search results" className="border-b border-border">
          <p role="status" className="px-4 py-2 text-label text-muted">
            {state.results.length === 0
              ? "No patients match."
              : `${state.results.length} match${state.results.length === 1 ? "" : "es"}${state.results.length >= 25 ? " (first 25; refine the search)" : ""}.`}
          </p>
          {state.results.length > 0 && <PatientTable rows={state.results} caption="Patient search results" />}
        </section>
      )}
    </div>
  );
}
