import Link from "next/link";
import { ArrowRight, Info } from "lucide-react";
import { todayIn } from "@rules/calendar";
import { resolveRule } from "@rules/engine";
import type { Rule } from "@rules/types";
import { Badge } from "@/components/ui/Badge";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { CARC, CATEGORY_LABELS } from "@/domain/carc";
import type { Block } from "@/domain/university/content";

const UNIT_LABELS: Record<Rule["unit"], (value: number) => string> = {
  calendar_days: (value) => `${value} calendar ${value === 1 ? "day" : "days"}`,
  months: (value) => `${value} ${value === 1 ? "month" : "months"}`,
  percent_per_year: (value) => `${value}% per year`,
};

/** A rule row: the catalog's own title, value, citation, and verification state, never retyped. */
function RulesBlock({ block, today }: { block: Extract<Block, { kind: "rules" }>; today: string }) {
  const rules = block.ruleIds.map((id) => resolveRule(id, today));
  return (
    <div className="overflow-hidden rounded-panel border border-border">
      <Table caption={block.caption}>
        <thead>
          <tr>
            <Th>Rule</Th>
            <Th>Value</Th>
            <Th>Source</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <Tr key={rule.id}>
              <Td className="font-medium">{rule.title}</Td>
              <Td>
                <span className="font-mono tabular-nums">{UNIT_LABELS[rule.unit](rule.value)}</span>
              </Td>
              <Td>{rule.citation}</Td>
              <Td>
                {rule.verify ? (
                  <Badge tone="warning" dot={false}>
                    Pending counsel verification
                  </Badge>
                ) : (
                  <Badge tone="success" dot={false}>
                    Verified
                  </Badge>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function CarcsBlock({ block }: { block: Extract<Block, { kind: "carcs" }> }) {
  return (
    <div className="overflow-hidden rounded-panel border border-border">
      <Table caption={block.caption}>
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Summary</Th>
            <Th>DenialDesk category</Th>
          </tr>
        </thead>
        <tbody>
          {block.codes.map((code) => {
            const entry = CARC[code];
            if (!entry) return null;
            return (
              <Tr key={code}>
                <Td>
                  <Code>CARC {code}</Code>
                </Td>
                <Td>{entry.summary}</Td>
                <Td>{CATEGORY_LABELS[entry.category]}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      <p className="border-t border-border bg-surface-muted px-3 py-2 text-caption text-muted">
        Summaries, not the official X12 wording; categories are DenialDesk&rsquo;s own classification.
      </p>
    </div>
  );
}

function TableBlock({ block }: { block: Extract<Block, { kind: "table" }> }) {
  return (
    <div className="overflow-hidden rounded-panel border border-border">
      <Table caption={block.caption}>
        <thead>
          <tr>
            {block.columns.map((column) => (
              <Th key={column}>{column}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, index) => (
            <Tr key={index}>
              {row.map((cell, cellIndex) => (
                <Td key={cellIndex} className={cellIndex === 0 ? "font-medium" : undefined}>
                  {cell}
                </Td>
              ))}
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

/** Renders lesson blocks (docs/specs/denialdesk-university.md). Server component: reads the rules catalog. */
export function LessonBody({ blocks }: { blocks: Block[] }) {
  const today = todayIn();
  return (
    <div className="flex max-w-[720px] flex-col gap-5 text-body text-text">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "p":
            return <p key={index}>{block.text}</p>;
          case "list":
            return (
              <ul key={index} className="flex list-disc flex-col gap-2 pl-5">
                {block.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            );
          case "callout":
            return (
              <aside
                key={index}
                aria-label={block.title}
                className="rounded-panel border border-border bg-surface-muted px-4 py-3"
              >
                <p className="text-label font-semibold tracking-wider text-muted uppercase">In DenialDesk</p>
                <p className="mt-1 font-semibold text-text">{block.title}</p>
                <p className="mt-1 text-muted">{block.text}</p>
                {block.href && (
                  <Link
                    href={block.href}
                    className="mt-2 inline-flex items-center gap-1 font-medium text-link hover:underline"
                  >
                    {block.linkLabel}
                    <ArrowRight aria-hidden="true" className="size-3.5" strokeWidth={2} />
                  </Link>
                )}
              </aside>
            );
          case "notice":
            return (
              <p
                key={index}
                role="note"
                className="flex gap-2 rounded-panel border border-info-border bg-info-bg px-4 py-3 text-label text-info-fg"
              >
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
                <span>{block.text}</span>
              </p>
            );
          case "rules":
            return <RulesBlock key={index} block={block} today={today} />;
          case "carcs":
            return <CarcsBlock key={index} block={block} />;
          case "table":
            return <TableBlock key={index} block={block} />;
        }
      })}
    </div>
  );
}
