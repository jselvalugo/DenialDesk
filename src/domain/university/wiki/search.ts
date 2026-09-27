import type { WikiArticle } from "./types";

/** Case-insensitive match on title, summary, tags, and body; blank query returns everything. */
export function searchArticles(articles: WikiArticle[], query: string): WikiArticle[] {
  const q = query.trim().toLowerCase();
  if (!q) return articles;
  const terms = q.split(/\s+/).filter(Boolean);
  return articles.filter((article) => {
    const haystack = [article.title, article.summary, article.tags.join(" "), article.body]
      .join("\n")
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** Search box input is capped so an oversized query can't be pasted in; it is never logged. */
export const MAX_QUERY_LENGTH = 120;

export function normalizeQuery(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value ?? "").slice(0, MAX_QUERY_LENGTH);
}
