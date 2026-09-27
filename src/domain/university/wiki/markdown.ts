/**
 * The Markdown subset wiki articles are written in, parsed into a small block tree that the
 * ArticleBody component renders as React elements (never raw HTML).
 *
 * Blocks (one per line, blank lines separate paragraphs):
 *   `## Heading`, `### Sub-heading`        headings (h2 and h3; the article title is metadata)
 *   `- item`                                bulleted list (consecutive lines)
 *   `1. item`                               numbered list (consecutive lines)
 *   `> text`                                note (consecutive lines join into one note)
 *   `| a | b |` with a `| --- | --- |` row  table (first row is the header)
 *   anything else                           paragraph (consecutive lines join with a space)
 * Inline, in any block:
 *   `**bold**`, `` `code` ``, `[text](href)` where href is `/path` or `https://...`, and
 *   `{{rule:<rule id>}}`, which renders the value of that rule in force today from `rules/`.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "rule"; id: string };

export type Block =
  | { type: "heading"; level: 2 | 3; id: string; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "note"; children: Inline[] }
  | { type: "table"; header: Inline[][]; rows: Inline[][][] };

/** Heading anchor: lowercase words joined by hyphens, from the heading's plain text. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Only same-app paths and https addresses may be links; anything else renders as plain text. */
export function isSafeHref(href: string): boolean {
  return (
    (href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\")) || href.startsWith("https://")
  );
}

const INLINE = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))|(\{\{rule:([a-z0-9_.]+)\}\})/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ type: "text", text: text.slice(last, index) });
    if (match[2] !== undefined) {
      out.push({ type: "strong", children: parseInline(match[2]) });
    } else if (match[4] !== undefined) {
      out.push({ type: "code", text: match[4] });
    } else if (match[6] !== undefined && match[7] !== undefined) {
      if (isSafeHref(match[7])) out.push({ type: "link", href: match[7], children: parseInline(match[6]) });
      else out.push(...parseInline(match[6]));
    } else if (match[9] !== undefined) {
      out.push({ type: "rule", id: match[9] });
    }
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

export function plainText(inlines: Inline[]): string {
  return inlines
    .map((node) => {
      switch (node.type) {
        case "text":
        case "code":
          return node.text;
        case "strong":
        case "link":
          return plainText(node.children);
        case "rule":
          return node.id;
      }
    })
    .join("");
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;

export function parseMarkdown(body: string): Block[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  const seenIds = new Map<string, number>();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "") {
      i += 1;
      continue;
    }
    const heading = /^(##|###)\s+(.+)$/.exec(trimmed);
    if (heading) {
      const children = parseInline(heading[2]!.trim());
      const base = slugify(plainText(children)) || "section";
      const count = seenIds.get(base) ?? 0;
      seenIds.set(base, count + 1);
      blocks.push({
        type: "heading",
        level: heading[1] === "##" ? 2 : 3,
        id: count ? `${base}-${count + 1}` : base,
        children,
      });
      i += 1;
      continue;
    }
    if (/^[-*]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      const ordered = /^\d+[.)]\s+/.test(trimmed);
      const marker = ordered ? /^\d+[.)]\s+/ : /^[-*]\s+/;
      const items: Inline[][] = [];
      while (i < lines.length && marker.test(lines[i]!.trim())) {
        items.push(parseInline(lines[i]!.trim().replace(marker, "")));
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    if (trimmed.startsWith(">")) {
      const parts: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith(">")) {
        parts.push(lines[i]!.trim().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "note", children: parseInline(parts.join(" ").trim()) });
      continue;
    }
    if (trimmed.startsWith("|") && i + 1 < lines.length && SEPARATOR.test(lines[i + 1]!.trim())) {
      const header = splitRow(trimmed).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        rows.push(splitRow(lines[i]!).map(parseInline));
        i += 1;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }
    const parts: string[] = [];
    while (i < lines.length) {
      const current = lines[i]!.trim();
      if (
        current === "" ||
        /^(##|###)\s+/.test(current) ||
        /^[-*]\s+/.test(current) ||
        /^\d+[.)]\s+/.test(current) ||
        current.startsWith(">") ||
        current.startsWith("|")
      ) {
        break;
      }
      parts.push(current);
      i += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(parts.join(" ")) });
  }
  return blocks;
}

function walkInline(inlines: Inline[], visit: (node: Inline) => void) {
  for (const node of inlines) {
    visit(node);
    if (node.type === "strong" || node.type === "link") walkInline(node.children, visit);
  }
}

/** Every inline node in document order (links and rule tokens are what callers look for). */
export function inlineNodes(blocks: Block[]): Inline[] {
  const out: Inline[] = [];
  const visit = (node: Inline) => out.push(node);
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
      case "paragraph":
      case "note":
        walkInline(block.children, visit);
        break;
      case "list":
        for (const item of block.items) walkInline(item, visit);
        break;
      case "table":
        for (const cell of block.header) walkInline(cell, visit);
        for (const row of block.rows) for (const cell of row) walkInline(cell, visit);
        break;
    }
  }
  return out;
}

export function ruleIds(blocks: Block[]): string[] {
  const ids = new Set<string>();
  for (const node of inlineNodes(blocks)) if (node.type === "rule") ids.add(node.id);
  return [...ids];
}

export function linkHrefs(blocks: Block[]): string[] {
  return inlineNodes(blocks).flatMap((node) => (node.type === "link" ? [node.href] : []));
}

export function headings(blocks: Block[]): { level: 2 | 3; id: string; text: string }[] {
  return blocks.flatMap((block) =>
    block.type === "heading" ? [{ level: block.level, id: block.id, text: plainText(block.children) }] : [],
  );
}
