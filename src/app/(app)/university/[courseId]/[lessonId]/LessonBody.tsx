import Link from "next/link";
import { ArrowRight, Info } from "lucide-react";
import { todayIn } from "@rules/calendar";
import { resolveRule } from "@rules/engine";
import type { Rule } from "@rules/types";
import { Badge } from "@/components/ui/Badge";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { CARC, CATEGORY_LABEL_KEYS } from "@/domain/carc";
import { regimeLabel } from "@/domain/denial-status";
import { GROUP_CODES } from "@/domain/group-codes";
import type { Block } from "@/domain/university/content";
import type { Formatters } from "@/i18n/format";
import type { Messages } from "@/i18n/messages/types";
import { getFormat, getT } from "@/i18n/server";
import type { Translator } from "@/i18n/translate";

const plural = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

const UNIT_LABELS: Record<Rule["unit"], (value: number) => string> = {
  calendar_days: (value) => plural(value, "calendar day", "calendar days"),
  business_days: (value) => plural(value, "business day", "business days"),
  months: (value) => plural(value, "month", "months"),
  years: (value) => plural(value, "year", "years"),
  hours_after_next_business_day: (value) =>
    `${plural(value, "hour", "hours")} after the start of the next business day`,
  percent_per_year: (value) => `${value}% per year`,
};

/** What each clock is counted from (rules/types.ts RuleAnchor), in plain words. */
const ANCHOR_LABELS: Record<NonNullable<Rule["anchor"]>, string> = {
  service_date: "Date of service",
  payer_receipt: "Payer's receipt of the claim",
  notice_date: "Date of the notice",
  presumed_notice_receipt: "Presumed receipt of the notice",
  contest_notice: "Payer's contest notice",
  primary_final_determination: "Primary payer's final determination",
  overpayment_demand_receipt: "Receipt of the overpayment demand",
  payment_date: "Date of payment",
  overpayment_determined: "When the overpayment was determined",
  payment_due_date: "Payment due date",
  prior_decision_receipt: "Receipt of the prior level's decision",
};

type CommonT = Translator<Messages["common"]>;
type UniversityT = Translator<Messages["university"]>;

function regimeList(rule: Rule, tc: CommonT): string {
  return rule.regimes.map((regime) => regimeLabel(regime, tc)).join(", ");
}

/** A rule row: the catalog's own title, value, citation, and verification state, never retyped. */
function RulesBlock({
  block,
  today,
  t,
  tc,
  f,
}: {
  block: Extract<Block, { kind: "rules" }>;
  today: string;
  t: UniversityT;
  tc: CommonT;
  f: Formatters;
}) {
  const reference = new Set(block.referenceOnly ?? []);
  // A rule with no version in force today renders a row saying so, never a crashed page.
  const rules = block.ruleIds.map((id) => {
    try {
      return resolveRule(id, today);
    } catch {
      return id;
    }
  });
  return (
    <div className="overflow-hidden rounded-panel border border-border">
      <Table caption={block.caption}>
        <thead>
          <tr>
            <Th>{t("lessonBody.rule")}</Th>
            <Th>{t("lessonBody.appliesTo")}</Th>
            <Th>{t("lessonBody.countedFrom")}</Th>
            <Th>{t("lessonBody.value")}</Th>
            <Th>{t("lessonBody.source")}</Th>
            <Th>{tc("word.status")}</Th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) =>
            typeof rule === "string" ? (
              <Tr key={rule}>
                <Td colSpan={6}>{t("lessonBody.noVersion")}</Td>
              </Tr>
            ) : (
              <Tr key={rule.id}>
                <Td className="font-medium">{rule.title}</Td>
                <Td>{regimeList(rule, tc)}</Td>
                <Td>{rule.anchor ? ANCHOR_LABELS[rule.anchor] : "—"}</Td>
                <Td>
                  <span className="font-mono tabular-nums">{UNIT_LABELS[rule.unit](rule.value)}</span>
                </Td>
                <Td>{rule.citation}</Td>
                <Td>
                  {reference.has(rule.id) && (
                    <Badge tone="neutral" dot={false}>
                      {t("lessonBody.referenceOnly")}
                    </Badge>
                  )}{" "}
                  {!rule.verify && rule.confirmedBy ? (
                    <Badge tone="success" dot={false}>
                      {t("lessonBody.confirmedByCounsel", { date: f.date(rule.confirmedBy.on) })}
                    </Badge>
                  ) : (
                    <Badge tone="warning" dot={false}>
                      {t("lessonBody.pendingCounselVerification")}
                    </Badge>
                  )}
                </Td>
              </Tr>
            ),
          )}
        </tbody>
      </Table>
    </div>
  );
}

function CarcsBlock({
  block,
  t,
  tc,
}: {
  block: Extract<Block, { kind: "carcs" }>;
  t: UniversityT;
  tc: CommonT;
}) {
  return (
    <div className="overflow-hidden rounded-panel border border-border">
      <Table caption={block.caption}>
        <thead>
          <tr>
            <Th>{t("lessonBody.code")}</Th>
            <Th>{t("lessonBody.summary")}</Th>
            <Th>{t("lessonBody.category")}</Th>
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
                <Td>{tc(CATEGORY_LABEL_KEYS[entry.category])}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      <p className="border-t border-border bg-surface-muted px-3 py-2 text-caption text-muted">
        {t("lessonBody.carcFootnote")}
      </p>
    </div>
  );
}

function GroupCodesBlock({
  block,
  t,
  tc,
}: {
  block: Extract<Block, { kind: "groupCodes" }>;
  t: UniversityT;
  tc: CommonT;
}) {
  return (
    <div className="overflow-hidden rounded-panel border border-border">
      <Table caption={block.caption}>
        <thead>
          <tr>
            <Th>{t("lessonBody.groupCode")}</Th>
            <Th>{tc("word.name")}</Th>
            <Th>{t("lessonBody.summary")}</Th>
          </tr>
        </thead>
        <tbody>
          {block.codes.map((code) => {
            const entry = GROUP_CODES[code];
            if (!entry) return null;
            return (
              <Tr key={code}>
                <Td>
                  <Code>{code}</Code>
                </Td>
                <Td className="font-medium">{entry.name}</Td>
                <Td>{entry.summary}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      <p className="border-t border-border bg-surface-muted px-3 py-2 text-caption text-muted">
        {t("lessonBody.groupCodeFootnote")}
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
export async function LessonBody({ blocks }: { blocks: Block[] }) {
  const today = todayIn();
  const t = await getT("university");
  const tc = await getT("common");
  const f = await getFormat();
  return (
    <div className="flex flex-col gap-5 text-body text-text">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "p":
            return (
              <p key={index} className="max-w-[720px]">
                {block.text}
              </p>
            );
          case "list":
            return (
              <ul key={index} className="flex max-w-[720px] list-disc flex-col gap-2 pl-5">
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
                className="max-w-[720px] rounded-panel border border-border bg-surface-muted px-4 py-3"
              >
                <p className="text-label font-semibold tracking-wider text-muted uppercase">
                  {t("lessonBody.inDenialDesk")}
                </p>
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
                className="flex max-w-[720px] gap-2 rounded-panel border border-info-border bg-info-bg px-4 py-3 text-label text-info-fg"
              >
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
                <span>{block.text}</span>
              </p>
            );
          case "rules":
            return <RulesBlock key={index} block={block} today={today} t={t} tc={tc} f={f} />;
          case "carcs":
            return <CarcsBlock key={index} block={block} t={t} tc={tc} />;
          case "groupCodes":
            return <GroupCodesBlock key={index} block={block} t={t} tc={tc} />;
          case "table":
            return <TableBlock key={index} block={block} />;
        }
      })}
    </div>
  );
}
