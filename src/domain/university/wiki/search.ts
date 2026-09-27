import { todayIn } from "@rules/calendar";
import { inlineNodes, parseMarkdown, ruleIds } from "./markdown";
import { ruleReference } from "./rule-tokens";
import type { WikiArticle } from "./types";

const searchText = new Map<string, string>();

/** What a reader sees: the rendered body text with rule tokens replaced by the value in force, not the markup. */
function readableText(article: WikiArticle, asOf: string): string {
  const key = `${article.slug}@${asOf}`;
  const cached = searchText.get(key);
  if (cached) return cached;
  const blocks = parseMarkdown(article.body);
  const values = ruleIds(blocks).map((id) => ruleReference(id, asOf)?.valueText ?? "");
  const body = inlineNodes(blocks)
    .map((node) => (node.type === "text" || node.type === "code" ? node.text : ""))
    .join(" ");
  const text = [article.title, article.summary, article.tags.join(" "), body, values.join(" ")]
    .join("\n")
    .toLowerCase();
  searchText.set(key, text);
  return text;
}

/** Case-insensitive match on title, summary, tags, and the rendered body; blank query returns everything. */
export function searchArticles(
  articles: WikiArticle[],
  query: string,
  asOf: string = todayIn(),
): WikiArticle[] {
  const q = query.trim().toLowerCase();
  if (!q) return articles;
  const terms = q.split(/\s+/).filter(Boolean);
  return articles.filter((article) => terms.every((term) => readableText(article, asOf).includes(term)));
}

/** Search box input is capped so an oversized query can't be pasted in; it is never logged. */
export const MAX_QUERY_LENGTH = 120;

export function normalizeQuery(raw: string): string {
  return raw.slice(0, MAX_QUERY_LENGTH);
}
