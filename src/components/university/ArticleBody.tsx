import Link from "next/link";
import type { Block, Inline } from "@/domain/university/wiki/markdown";
import type { RuleReference } from "@/domain/university/wiki/rule-tokens";
import { Code } from "@/components/ui/Code";
import type { Messages } from "@/i18n/messages/types";
import { getT } from "@/i18n/server";
import type { Translator } from "@/i18n/translate";

type UniversityT = Translator<Messages["university"]>;

/**
 * Renders a wiki article's block tree (docs/specs/university-wiki.md). Everything is a React
 * element built from parsed text: no raw HTML, and only same-app or https links are links.
 */
export async function ArticleBody({
  blocks,
  rules,
}: {
  blocks: Block[];
  rules: Map<string, RuleReference | null>;
}) {
  const t = await getT("university");
  return (
    <div className="max-w-3xl text-body text-text">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} rules={rules} t={t} />
      ))}
    </div>
  );
}

function BlockView({
  block,
  rules,
  t,
}: {
  block: Block;
  rules: Map<string, RuleReference | null>;
  t: UniversityT;
}) {
  switch (block.type) {
    case "heading":
      return block.level === 2 ? (
        <h2 id={block.id} className="mt-8 mb-2 scroll-mt-24 text-title font-semibold text-primary first:mt-0">
          <Inlines nodes={block.children} rules={rules} t={t} />
        </h2>
      ) : (
        <h3 id={block.id} className="mt-6 mb-2 scroll-mt-24 text-heading font-semibold text-text">
          <Inlines nodes={block.children} rules={rules} t={t} />
        </h3>
      );
    case "paragraph":
      return (
        <p className="my-3 leading-6">
          <Inlines nodes={block.children} rules={rules} t={t} />
        </p>
      );
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index} className="pl-1">
          <Inlines nodes={item} rules={rules} t={t} />
        </li>
      ));
      return block.ordered ? (
        <ol className="my-3 list-decimal space-y-1.5 pl-6">{items}</ol>
      ) : (
        <ul className="my-3 list-disc space-y-1.5 pl-6">{items}</ul>
      );
    }
    case "note":
      return (
        <aside
          role="note"
          className="my-4 border-l-2 border-accent bg-surface-muted px-4 py-3 text-body text-text"
        >
          <Inlines nodes={block.children} rules={rules} t={t} />
        </aside>
      );
    case "table":
      return (
        <div className="my-4 overflow-x-auto rounded-panel border border-border">
          <table className="w-full border-collapse text-table">
            <thead className="bg-surface-muted">
              <tr>
                {block.header.map((cell, index) => (
                  <th
                    key={index}
                    scope="col"
                    className="border-b border-border px-3 py-2 text-left text-label font-semibold tracking-wider text-muted uppercase"
                  >
                    <Inlines nodes={cell} rules={rules} t={t} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-border last:border-b-0">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="px-3 py-2 align-top">
                      <Inlines nodes={cell} rules={rules} t={t} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

function Inlines({
  nodes,
  rules,
  t,
}: {
  nodes: Inline[];
  rules: Map<string, RuleReference | null>;
  t: UniversityT;
}) {
  return (
    <>
      {nodes.map((node, index) => (
        <InlineView key={index} node={node} rules={rules} t={t} />
      ))}
    </>
  );
}

function InlineView({
  node,
  rules,
  t,
}: {
  node: Inline;
  rules: Map<string, RuleReference | null>;
  t: UniversityT;
}) {
  switch (node.type) {
    case "text":
      return <>{node.text}</>;
    case "strong":
      return (
        <strong className="font-semibold">
          <Inlines nodes={node.children} rules={rules} t={t} />
        </strong>
      );
    case "code":
      return <Code>{node.text}</Code>;
    case "link":
      return node.href.startsWith("/") ? (
        <Link
          href={node.href}
          className="text-link underline decoration-border-strong underline-offset-2 hover:decoration-link"
        >
          <Inlines nodes={node.children} rules={rules} t={t} />
        </Link>
      ) : (
        <a
          href={node.href}
          rel="noopener noreferrer"
          target="_blank"
          className="text-link underline decoration-border-strong underline-offset-2 hover:decoration-link"
        >
          <Inlines nodes={node.children} rules={rules} t={t} />
          <span className="sr-only"> {t("article.opensNewTab")}</span>
        </a>
      );
    case "rule":
      return <RuleValue reference={rules.get(node.id) ?? null} id={node.id} t={t} />;
  }
}

/** A legal value read from `rules/`: the number in mono, then its citation and confirmation state. */
export function RuleValue({
  reference,
  id,
  t,
}: {
  reference: RuleReference | null;
  id: string;
  t: UniversityT;
}) {
  if (!reference) {
    return (
      <span className="text-muted" data-rule={id}>
        {t("article.notInForce")}
      </span>
    );
  }
  return (
    <span data-rule={id}>
      <span className="font-mono text-text">{reference.value}</span> {reference.unit}
      <span className="text-label text-subtle">
        {" "}
        ({reference.citation}
        {reference.unconfirmed ? t("article.unconfirmedMarker") : ""})
      </span>
    </span>
  );
}
