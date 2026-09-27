import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayIn } from "@rules/calendar";
import { canViewUniversity } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { ArticleBody, RuleValue } from "@/components/university/ArticleBody";
import { Panel } from "@/components/ui/Panel";
import { findArticle, findCategory } from "@/domain/university/wiki/catalog";
import { headings, parseMarkdown, ruleIds } from "@/domain/university/wiki/markdown";
import { ruleReferences } from "@/domain/university/wiki/rule-tokens";
import { getFormat, getT } from "@/i18n/server";
import { UniversityHeader } from "../../UniversityHeader";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const article = findArticle((await params).slug);
  const t = await getT("university");
  return { title: article ? t("article.metaTitle", { title: article.title }) : t("wiki.title") };
}

// Never pre-rendered: every request runs requireAuth() first.
export const dynamic = "force-dynamic";

export default async function WikiArticlePage({ params }: { params: Params }) {
  const auth = await requireAuth();
  if (!canViewUniversity(auth.role)) notFound();
  const article = findArticle((await params).slug);
  if (!article) notFound();
  const t = await getT("university");
  const f = await getFormat();

  const blocks = parseMarkdown(article.body);
  const outline = headings(blocks).filter((heading) => heading.level === 2);
  const rules = ruleReferences(ruleIds(blocks), todayIn());
  const referenced = [...rules.entries()];
  const related = article.related.map(findArticle).filter((item) => item !== null);
  const category = findCategory(article.category);

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label={t("nav.breadcrumb")} className="text-label text-muted">
        <Link href="/university" className="hover:text-text hover:underline">
          {t("breadcrumb.university")}
        </Link>
        <span aria-hidden="true"> / </span>
        <Link href="/university/wiki" className="hover:text-text hover:underline">
          {t("wiki.title")}
        </Link>
        <span aria-hidden="true"> / </span>
        <Link href={`/university/wiki#${category.id}`} className="hover:text-text hover:underline">
          {t(category.labelKey)}
        </Link>
      </nav>
      <UniversityHeader eyebrow={t("wiki.eyebrow")} title={article.title} description={article.summary} />
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_280px]">
        <Panel>
          <article aria-label={article.title}>
            <ArticleBody blocks={blocks} rules={rules} />
          </article>
        </Panel>
        <div className="flex flex-col gap-4 lg:sticky lg:top-4">
          {outline.length > 0 && (
            <Panel title={t("article.onThisPage")}>
              <nav aria-label={t("article.onThisPage")}>
                <ul className="flex flex-col gap-1 text-body">
                  {outline.map((heading) => (
                    <li key={heading.id}>
                      <a href={`#${heading.id}`} className="text-link hover:underline">
                        {heading.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </Panel>
          )}
          {referenced.length > 0 && (
            <Panel title={t("article.rulesReferenced")} description={t("article.rulesReferencedDescription")}>
              <ul className="flex flex-col gap-2 text-body">
                {referenced.map(([id, reference]) => (
                  <li key={id} className="flex flex-col">
                    <span className="text-text">{reference?.title ?? id}</span>
                    <span>
                      <RuleValue reference={reference} id={id} t={t} />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-label text-subtle">{t("article.unconfirmedNote")}</p>
            </Panel>
          )}
          {related.length > 0 && (
            <Panel title={t("article.relatedArticles")}>
              <ul className="flex flex-col gap-1 text-body">
                {related.map((item) => (
                  <li key={item.slug}>
                    <Link href={`/university/wiki/${item.slug}`} className="text-link hover:underline">
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title={t("article.sources")}>
            <ul className="flex flex-col gap-1 text-body">
              {article.sources.map((source) => (
                <li key={source.label}>
                  {source.href ? (
                    <a
                      href={source.href}
                      rel="noopener noreferrer"
                      target="_blank"
                      className="text-link underline decoration-border-strong underline-offset-2 hover:decoration-link"
                    >
                      {source.label}
                      <span className="sr-only"> {t("article.opensNewTab")}</span>
                    </a>
                  ) : (
                    <span className="text-text">{source.label}</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-label text-subtle">
              {t("article.lastReviewed", { date: f.date(article.reviewedOn) })}
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
