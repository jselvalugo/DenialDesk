import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canViewUniversity } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { articlesInCategory, WIKI_CATEGORIES } from "@/domain/university/wiki/catalog";
import type { WikiArticle } from "@/domain/university/wiki/types";
import { getT } from "@/i18n/server";
import { UniversityHeader } from "../UniversityHeader";
import { WikiSearch } from "./WikiSearch";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("university");
  return { title: t("wiki.metaTitle") };
}

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
  const t = await getT("university");

  return (
    <div className="flex flex-col gap-4">
      <UniversityHeader
        eyebrow={t("wiki.eyebrow")}
        title={t("wiki.title")}
        description={t("wiki.description")}
        actions={
          <Link
            href="/university"
            className="inline-flex h-8 items-center rounded-control border border-border-strong bg-surface px-3 text-body font-medium text-text hover:bg-surface-muted"
          >
            {t("catalog.title")}
          </Link>
        }
      />
      <WikiSearch />
      <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <nav aria-label={t("wiki.categoriesAria")} className="lg:sticky lg:top-4 lg:self-start">
          <ul className="flex flex-col gap-0.5">
            {WIKI_CATEGORIES.map((category) => (
              <li key={category.id}>
                <a
                  href={`#${category.id}`}
                  className="flex items-center justify-between rounded-control px-2 py-1.5 text-body text-text hover:bg-surface-muted"
                >
                  <span>{t(category.labelKey)}</span>
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
                      {t(category.labelKey)}
                    </h2>
                    <p className="text-label text-muted">{t(category.descriptionKey)}</p>
                  </div>
                  {articles.length === 0 ? (
                    <EmptyState
                      title={t("wiki.emptyCategoryTitle")}
                      description={t("wiki.emptyCategoryDescription")}
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
