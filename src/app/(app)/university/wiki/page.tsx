import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canViewUniversity } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  articlesInCategory,
  findCategory,
  WIKI_ARTICLES,
  WIKI_CATEGORIES,
} from "@/domain/university/wiki/catalog";
import { MAX_QUERY_LENGTH, normalizeQuery, searchArticles } from "@/domain/university/wiki/search";
import type { WikiArticle } from "@/domain/university/wiki/types";

export const metadata: Metadata = { title: "University — Wiki" };

function ArticleRow({ article, showCategory = false }: { article: WikiArticle; showCategory?: boolean }) {
  return (
    <li className="px-5 py-4">
      <Link
        href={`/university/wiki/${article.slug}`}
        className="text-body font-medium text-link underline decoration-border underline-offset-2 hover:decoration-link"
      >
        {article.title}
      </Link>
      <p className="mt-0.5 text-body text-muted">{article.summary}</p>
      <p className="mt-1 text-label text-subtle">
        {showCategory ? `${findCategory(article.category).label} · ` : ""}
        {article.tags.slice(0, 5).join(" · ")}
      </p>
    </li>
  );
}

export default async function WikiIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  if (!canViewUniversity(auth.role)) notFound();
  const query = normalizeQuery((await searchParams).q);
  const matches = searchArticles(WIKI_ARTICLES, query);
  const searching = query.trim() !== "";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Wiki"
        description="Reference articles on how denials, claims, appeals, and Florida payment rules work in DenialDesk. Legal values are read from the rules engine, never typed in."
      />
      <form method="get" action="/university/wiki" role="search" className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="wiki-q" className="text-label font-medium text-muted">
            Search the wiki
          </label>
          <input
            id="wiki-q"
            name="q"
            type="search"
            defaultValue={query}
            maxLength={MAX_QUERY_LENGTH}
            placeholder="Title, term, or code, e.g. prompt pay"
            className="h-8 w-80 max-w-full rounded-control border border-border-strong bg-surface px-2.5 text-body text-text placeholder:text-subtle"
          />
        </div>
        <button
          type="submit"
          className="inline-flex h-8 items-center rounded-control border border-primary bg-primary px-3 text-body font-medium text-white hover:bg-primary-hover"
        >
          Search
        </button>
        {searching && (
          <Link
            href="/university/wiki"
            className="inline-flex h-8 items-center px-2 text-body text-muted hover:text-text"
          >
            Clear
          </Link>
        )}
      </form>

      {searching ? (
        <Panel
          title={`${matches.length} ${matches.length === 1 ? "article matches" : "articles match"} "${query.trim()}"`}
          flush
        >
          {matches.length === 0 ? (
            <EmptyState
              title="No article matches"
              description="Try a shorter word, a code type such as CARC, or browse the categories below by clearing the search."
              action={
                <Link
                  href="/university/wiki"
                  className="text-body font-medium text-link underline underline-offset-2"
                >
                  Show all articles
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {matches.map((article) => (
                <ArticleRow key={article.slug} article={article} showCategory />
              ))}
            </ul>
          )}
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <nav aria-label="Categories" className="lg:sticky lg:top-4 lg:self-start">
            <ul className="flex flex-col gap-0.5">
              {WIKI_CATEGORIES.map((category) => (
                <li key={category.id}>
                  <a
                    href={`#${category.id}`}
                    className="flex items-center justify-between rounded-control px-2 py-1.5 text-body text-text hover:bg-surface-muted"
                  >
                    <span>{category.label}</span>
                    <span className="font-mono text-label text-subtle">
                      {articlesInCategory(category.id).length}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex flex-col gap-4">
            {WIKI_CATEGORIES.map((category) => {
              const articles = articlesInCategory(category.id);
              return (
                <section
                  key={category.id}
                  id={category.id}
                  aria-labelledby={`${category.id}-title`}
                  className="scroll-mt-24"
                >
                  <Panel flush>
                    <div className="border-b border-border px-5 py-3">
                      <h2 id={`${category.id}-title`} className="text-heading font-semibold text-primary">
                        {category.label}
                      </h2>
                      <p className="text-label text-muted">{category.description}</p>
                    </div>
                    {articles.length === 0 ? (
                      <EmptyState
                        title="No articles yet"
                        description="Articles for this category are still being written."
                      />
                    ) : (
                      <ul className="divide-y divide-border">
                        {articles.map((article) => (
                          <ArticleRow key={article.slug} article={article} />
                        ))}
                      </ul>
                    )}
                  </Panel>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
