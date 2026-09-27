/** Wiki content model (docs/specs/university-wiki.md). Articles are code: reviewed in PRs, no PHI. */

export type WikiCategoryId =
  | "getting-started"
  | "denials-and-appeals"
  | "claims-and-payments"
  | "florida-and-medicare-rules"
  | "data-safety"
  | "glossary";

export interface WikiCategory {
  id: WikiCategoryId;
  label: string;
  description: string;
}

export interface WikiSource {
  label: string;
  /** Internal path (`/...`), an `https://` address, or absent for a document the reader can't open from here. */
  href?: string;
}

export interface WikiArticle {
  /** URL segment: lowercase words joined by hyphens. */
  slug: string;
  title: string;
  /** One or two sentences shown on the index and under the title. */
  summary: string;
  category: WikiCategoryId;
  tags: string[];
  /** YYYY-MM-DD the content was last checked against the product and its sources. */
  reviewedOn: string;
  sources: WikiSource[];
  /** Slugs of related articles. */
  related: string[];
  /** Body in the Markdown subset documented in `markdown.ts`. */
  body: string;
}
