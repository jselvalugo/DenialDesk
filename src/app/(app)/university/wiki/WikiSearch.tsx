"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import { MAX_QUERY_LENGTH } from "@/domain/university/wiki/search";
import { searchWiki, type WikiSearchState } from "./actions";

/** Wiki search: a POST server action, so what is typed never appears in the URL (CLAUDE.md #4). */
export function WikiSearch() {
  const [state, action, pending] = useActionState<WikiSearchState, FormData>(searchWiki, {});
  const results = state.results;
  return (
    <div className="flex flex-col gap-4">
      <form action={action} role="search" className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="wiki-q" className="text-label font-medium text-muted">
            Search the wiki
          </label>
          <input
            id="wiki-q"
            name="q"
            type="search"
            maxLength={MAX_QUERY_LENGTH}
            autoComplete="off"
            placeholder="Title, term, or code, e.g. prompt pay"
            className="h-8 w-80 max-w-full rounded-control border border-border-strong bg-surface px-2.5 text-body text-text placeholder:text-subtle focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus"
          />
        </div>
        <Button type="submit" disabled={pending} aria-disabled={pending}>
          {pending ? "Searching…" : "Search"}
        </Button>
        <p className="text-label text-subtle">Product terms only, never patient details.</p>
      </form>
      {state.error && <FormAlert message={state.error} />}
      {results && state.query && (
        <section aria-label="Search results">
          <Panel flush>
            <p
              role="status"
              className="border-b border-border px-5 py-3 text-heading font-semibold text-primary"
            >
              {results.length} {results.length === 1 ? "article matches" : "articles match"} &ldquo;
              {state.query}&rdquo;
            </p>
            {results.length === 0 ? (
              <EmptyState
                title="No article matches"
                description="Try a shorter word or a code type such as CARC, or browse the categories below."
              />
            ) : (
              <ul className="divide-y divide-border">
                {results.map((article) => (
                  <li key={article.slug} className="px-5 py-4">
                    <Link
                      href={`/university/wiki/${article.slug}`}
                      className="text-body font-medium text-link underline decoration-border underline-offset-2 hover:decoration-link"
                    >
                      {article.title}
                    </Link>
                    <p className="mt-0.5 text-body text-muted">{article.summary}</p>
                    <p className="mt-1 text-label text-subtle">
                      {article.categoryLabel} · {article.tags.join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </section>
      )}
    </div>
  );
}
