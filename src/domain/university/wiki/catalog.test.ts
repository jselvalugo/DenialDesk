import { describe, expect, it } from "vitest";
import { todayIn } from "@rules/calendar";
import { articlesInCategory, findArticle, WIKI_ARTICLES, WIKI_CATEGORIES } from "./catalog";
import { linkHrefs, parseMarkdown, ruleIds } from "./markdown";
import { ruleExists, ruleReference } from "./rule-tokens";
import { searchArticles } from "./search";

/** Shipped pages an article may link to besides other articles (src/components/shell/navigation.ts). */
const SHIPPED_PATHS = [
  "/overview",
  "/denials",
  "/appeals",
  "/patients",
  "/claims",
  "/remittances",
  "/prompt-pay",
  "/insight",
  "/settings",
];

describe("wiki catalog (docs/specs/university-wiki.md)", () => {
  it("has unique, URL-safe slugs and a known category for every article", () => {
    const slugs = WIKI_ARTICLES.map((article) => article.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    const categories = new Set(WIKI_CATEGORIES.map((category) => category.id));
    for (const article of WIKI_ARTICLES) expect(categories.has(article.category)).toBe(true);
    for (const category of WIKI_CATEGORIES) expect(articlesInCategory(category.id).length).toBeGreaterThan(0);
  });

  it("every article has a summary, tags, at least one source, and a review date", () => {
    for (const article of WIKI_ARTICLES) {
      expect(article.summary.length, article.slug).toBeGreaterThan(20);
      expect(article.tags.length, article.slug).toBeGreaterThan(0);
      expect(article.sources.length, article.slug).toBeGreaterThan(0);
      expect(article.reviewedOn, article.slug).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const source of article.sources) {
        if (source.href) expect(source.href, article.slug).toMatch(/^https:\/\//);
      }
    }
  });

  it("every related slug and internal link resolves", () => {
    for (const article of WIKI_ARTICLES) {
      for (const slug of article.related) {
        expect(findArticle(slug), `${article.slug} → ${slug}`).not.toBeNull();
        expect(slug).not.toBe(article.slug);
      }
      for (const href of linkHrefs(parseMarkdown(article.body))) {
        if (!href.startsWith("/")) continue;
        const path = href.split("#")[0]!;
        const wiki = /^\/university\/wiki\/([a-z0-9-]+)$/.exec(path);
        if (wiki) expect(findArticle(wiki[1]!), `${article.slug} → ${href}`).not.toBeNull();
        else expect(SHIPPED_PATHS, `${article.slug} → ${href}`).toContain(path);
      }
    }
  });

  it("every rule token names a catalog rule with a version in force today", () => {
    const today = todayIn();
    for (const article of WIKI_ARTICLES) {
      for (const id of ruleIds(parseMarkdown(article.body))) {
        expect(ruleExists(id), `${article.slug} → ${id}`).toBe(true);
        expect(ruleReference(id, today), `${article.slug} → ${id} on ${today}`).not.toBeNull();
      }
    }
  });

  it("never types a statutory period into an article: numbers followed by a legal unit come from rule tokens", () => {
    // A bare "N calendar days" / "N months" / "N% per year" in prose would bypass rules/ (CLAUDE.md).
    // Product settings that are not legal values (session length, follow-up days) use other words.
    const typed =
      /\b\d+\s+(calendar|business)\s+days?\b|\b\d+\s+months?\b(?!\s+(ago|of))|\b\d+\s*%\s+per\s+year/i;
    for (const article of WIKI_ARTICLES) expect(article.body, article.slug).not.toMatch(typed);
  });

  it("contains nothing shaped like an SSN, a Medicare number, a phone number, or an e-mail", () => {
    const ssn = /\b\d{3}-\d{2}-\d{4}\b/;
    const mbi =
      /\b[1-9][AC-HJKMNP-RT-Yac-hjkmnp-rt-y][AC-HJKMNP-RT-Yac-hjkmnp-rt-y0-9]\d[AC-HJKMNP-RT-Yac-hjkmnp-rt-y][AC-HJKMNP-RT-Yac-hjkmnp-rt-y0-9]\d[AC-HJKMNP-RT-Yac-hjkmnp-rt-y]{2}\d{2}\b/;
    const phone = /\b\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/;
    const email = /[\w.+-]+@[\w-]+\.[\w.]+/;
    for (const article of WIKI_ARTICLES) {
      const text = [article.title, article.summary, article.body, article.tags.join(" ")].join("\n");
      expect(text, article.slug).not.toMatch(ssn);
      expect(text, article.slug).not.toMatch(mbi);
      expect(text, article.slug).not.toMatch(phone);
      expect(text, article.slug).not.toMatch(email);
    }
  });

  it("every article parses into at least one block and its headings are h2 before h3", () => {
    for (const article of WIKI_ARTICLES) {
      const blocks = parseMarkdown(article.body);
      expect(blocks.length, article.slug).toBeGreaterThan(0);
      let sawH2 = false;
      for (const block of blocks) {
        if (block.type !== "heading") continue;
        if (block.level === 2) sawH2 = true;
        else expect(sawH2, `${article.slug}: h3 before any h2`).toBe(true);
      }
    }
  });
});

describe("searchArticles", () => {
  it("returns everything for a blank query and matches every term case-insensitively", () => {
    expect(searchArticles(WIKI_ARTICLES, "  ")).toHaveLength(WIKI_ARTICLES.length);
    const hits = searchArticles(WIKI_ARTICLES, "PROMPT pay");
    expect(hits.map((article) => article.slug)).toContain("florida-prompt-pay-clock");
    expect(searchArticles(WIKI_ARTICLES, "carc")).not.toHaveLength(0);
    expect(searchArticles(WIKI_ARTICLES, "zzzz-no-such-term")).toEqual([]);
  });

  it("matches a rendered rule value and not a rule ID or link path", () => {
    expect(searchArticles(WIKI_ARTICLES, "calendar days").map((article) => article.slug)).toContain(
      "florida-prompt-pay-clock",
    );
    expect(searchArticles(WIKI_ARTICLES, "fl.promptpay")).toEqual([]);
    expect(searchArticles(WIKI_ARTICLES, "/remittances")).toEqual([]);
  });

  it("matches tags, not only titles", () => {
    expect(searchArticles(WIKI_ARTICLES, "641.3155").map((article) => article.slug)).toContain(
      "florida-prompt-pay-clock",
    );
  });
});
