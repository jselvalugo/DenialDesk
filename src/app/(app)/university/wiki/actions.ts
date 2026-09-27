"use server";

import { canViewUniversity } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { findCategory, WIKI_ARTICLES } from "@/domain/university/wiki/catalog";
import { normalizeQuery, searchArticles } from "@/domain/university/wiki/search";

export interface WikiSearchResult {
  slug: string;
  title: string;
  summary: string;
  categoryLabel: string;
  tags: string[];
}

export interface WikiSearchState {
  query?: string;
  results?: WikiSearchResult[];
  error?: string;
}

/**
 * Search runs as a POST server action so the query never enters the URL, browser history, or
 * request logs (CLAUDE.md #4, R-7.4.8): billing staff paste patient names into any search box.
 * The query itself is never logged.
 */
export async function searchWiki(_prev: WikiSearchState, formData: FormData): Promise<WikiSearchState> {
  const auth = await requireAuth();
  if (!canViewUniversity(auth.role)) return { error: "Your role cannot read the wiki." };
  const query = normalizeQuery(String(formData.get("q") ?? "")).trim();
  if (!query) return {};
  const results = searchArticles(WIKI_ARTICLES, query).map((article) => ({
    slug: article.slug,
    title: article.title,
    summary: article.summary,
    categoryLabel: findCategory(article.category).label,
    tags: article.tags.slice(0, 5),
  }));
  return { query, results };
}
