import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canViewUniversity } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { articlesInCategory, WIKI_CATEGORIES } from "@/domain/university/wiki/catalog";
import type { WikiArticle } from "@/domain/university/wiki/types";
import { UniversityHeader } from "../UniversityHeader";
import { WikiSearch } from "./WikiSearch";

export const metadata: Metadata = { title: "University — Wiki" };

function ArticleRow({ article }: { article: WikiArticle }) {
  return (
    <li className="px-5 py-4">
      <Link
        href={`/university/wiki/${article.slug}`}
        className="text-body font-medium text-link underline decoration-border underline-offset-2 hover:decoration-link"
      >
        {article.title}
      </Link>
      <p className="mt-0.5 text-body text-muted">{article.summary}</p>
      <p className="mt-1 text-label text-subtle">{article.tags.slice(0, 5).join(" · ")}</p>
    </li>
  );
}

export default async function WikiIndexPage() {
  const auth = await requireAuth();
  if (!canViewUniversity(auth.role)) notFound();

  return (
    <div className="flex flex-col gap-4">
      <UniversityHeader
        eyebrow="DenialDesk University"
        title="Wiki"
        description="Reference articles on how denials, claims, appeals, and Florida payment rules work in DenialDesk. Legal values are read from the rules engine, never typed in."
        actions={
          <Link
            href="/university"
            className="inline-flex h-8 items-center rounded-control border border-border-strong bg-surface px-3 text-body font-medium text-text hover:bg-surface-muted"
          >
            Courses
          </Link>
        }
      />
      <WikiSearch />
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
    </div>
  );
}
