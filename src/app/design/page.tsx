import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { DeadlineIndicator } from "@/components/ui/DeadlineIndicator";
import { Money } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { isProduction } from "@/lib/env";
import { formatDate } from "@/lib/format";
import { sampleAsOf, sampleQueue } from "./sample-data";

export const metadata: Metadata = { title: "Design system" };

const swatches: Array<{ group: string; tokens: Array<[string, string]> }> = [
  {
    group: "Brand",
    tokens: [
      ["navy (primary)", "#1A2C4E"],
      ["navy-700 (hover)", "#13213B"],
      ["blue (focus, charts)", "#2E75B6"],
      ["blue-700 (links, info)", "#245D93"],
      ["teal (accent)", "#1F6B75"],
      ["selected", "#EAF0F7"],
    ],
  },
  {
    group: "Neutrals",
    tokens: [
      ["canvas", "#F7F9FB"],
      ["surface", "#FFFFFF"],
      ["surface-muted", "#F1F5F9"],
      ["border", "#E2E8F0"],
      ["border-strong", "#768599"],
      ["text-muted", "#475569"],
    ],
  },
  {
    group: "Charts",
    tokens: [
      ["chart-1 teal", "#1F6B75"],
      ["chart-2 navy", "#1A2C4E"],
      ["chart-3 blue", "#2E75B6"],
      ["chart-4 amber", "#B7791F"],
      ["chart-5 orange", "#C05621"],
      ["chart-danger", "#A32D2D"],
    ],
  },
];

const tones: Array<[Tone, string, string]> = [
  ["danger", "Denied", "Overdue, denied, blocking"],
  ["warning", "Due soon", "Needs attention"],
  ["success", "Overturned", "Paid, complete"],
  ["info", "In review", "Submitted, in progress"],
  ["neutral", "Draft", "Closed, not applicable"],
];

const typeScale: Array<[string, string, string]> = [
  ["font-serif text-display font-bold text-primary", "Display · serif 28/36 · 700", "Denial queue"],
  ["text-title font-semibold", "Title · 18/26 · 600", "Appeals due this week"],
  ["text-heading font-semibold", "Heading · 15/22 · 600", "Remittance detail"],
  ["text-body", "Body · 14/20 · 400", "Payer acknowledged receipt of the claim and returned a 277CA."],
  ["text-table", "Table · 13/18 · 400", "Gulf Coast Mutual · CO-197 · $1,240.00"],
  ["text-label font-medium text-muted", "Label · 12/16 · 500", "Appeal deadline"],
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-[220px_1fr] gap-8 border-b border-border py-8 last:border-b-0">
      <div>
        <h2 className="text-heading font-semibold text-text">{title}</h2>
        <p className="mt-1 text-label text-muted">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export default function DesignSystemPage() {
  if (isProduction()) notFound();

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader
        title="Design system"
        description="Tokens and components every DenialDesk screen is built from. Source of truth: docs/DESIGN.md."
        actions={<Badge tone="neutral">Not available in production</Badge>}
      />

      <Panel
        title="Denial queue — sample"
        description={`Illustrative synthetic data as of ${formatDate(sampleAsOf)}. Not real claims; codes shown for layout only.`}
        flush
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm">Payer: All</Button>
            <Button size="sm">Category: All</Button>
            <Button size="sm" variant="primary">
              Assign selected
            </Button>
          </div>
        }
      >
        <Table caption="Sample denial queue sorted by appeal deadline">
          <thead>
            <tr>
              <Th>Claim</Th>
              <Th>Patient ref</Th>
              <Th>Payer</Th>
              <Th>Denial</Th>
              <Th numeric>Billed</Th>
              <Th numeric>At risk</Th>
              <Th aria-sort="ascending">
                Appeal deadline <span aria-hidden>↑</span>
              </Th>
              <Th>Status</Th>
              <Th>Assignee</Th>
            </tr>
          </thead>
          <tbody>
            {sampleQueue.map((row) => (
              <Tr key={row.claimId} selected={row.selected}>
                <Td className="font-mono text-label font-medium">{row.claimId}</Td>
                <Td className="font-mono text-label text-muted">{row.patientRef}</Td>
                <Td>{row.payer}</Td>
                <Td>
                  <span className="inline-flex items-center gap-2">
                    <Code>{row.code}</Code>
                    <span className="text-muted">{row.category}</span>
                  </span>
                </Td>
                <Td numeric>
                  <Money cents={row.billedCents} />
                </Td>
                <Td numeric className="font-medium">
                  <Money cents={row.atRiskCents} />
                </Td>
                <Td>
                  <DeadlineIndicator dueDate={row.dueDate} daysRemaining={row.daysRemaining} />
                </Td>
                <Td>
                  <Badge tone={row.statusTone}>{row.status}</Badge>
                </Td>
                <Td className="text-muted">{row.assignee}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <div className="flex items-center justify-between border-t border-border px-3 py-2.5 text-label text-muted">
          <span className="tabular">
            Showing 1–{sampleQueue.length} of {sampleQueue.length}
          </span>
          <span className="tabular">
            Total at risk{" "}
            <Money
              cents={sampleQueue.reduce((sum, row) => sum + row.atRiskCents, 0)}
              className="font-medium text-text"
            />
          </span>
        </div>
      </Panel>

      <Panel>
        <Section
          title="Color"
          description="Neutral by default. Color is reserved for status, urgency, and the primary action."
        >
          <div className="flex flex-col gap-6">
            {swatches.map(({ group, tokens }) => (
              <div key={group}>
                <p className="mb-2 text-label font-medium text-muted">{group}</p>
                <div className="grid grid-cols-6 gap-3">
                  {tokens.map(([name, hex]) => (
                    <div key={name} className="overflow-hidden rounded-panel border border-border">
                      <div className="h-12" style={{ backgroundColor: hex }} />
                      <div className="px-2 py-1.5">
                        <p className="text-label font-medium text-text">{name}</p>
                        <p className="font-mono text-label text-muted">{hex}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Status" description="Always a label with the color, never color alone (WCAG 1.4.1).">
          <div className="grid grid-cols-5 gap-3">
            {tones.map(([tone, label, meaning]) => (
              <div key={tone} className="flex flex-col items-start gap-1.5">
                <Badge tone={tone}>{label}</Badge>
                <span className="text-label text-muted">{meaning}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section
          title="Typography"
          description="Playfair Display for page titles, Inter for UI, Space Mono for codes, identifiers, and headline figures."
        >
          <div className="flex flex-col gap-4">
            {typeScale.map(([className, spec, sample]) => (
              <div key={spec} className="grid grid-cols-[200px_1fr] items-baseline gap-4">
                <span className="font-mono text-label text-muted">{spec}</span>
                <span className={className}>{sample}</span>
              </div>
            ))}
            <div className="grid grid-cols-[200px_1fr] items-baseline gap-4">
              <span className="font-mono text-label text-muted">Mono · codes</span>
              <span className="flex flex-wrap gap-2">
                <Code>CARC 197</Code>
                <Code>RARC N30</Code>
                <Code>CPT 99214</Code>
                <Code>ICD-10 E11.9</Code>
                <Code>NPI 1000000004</Code>
              </span>
            </div>
          </div>
        </Section>

        <Section title="Buttons" description="One primary action per view. Labels are verbs.">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary">Submit appeal</Button>
              <Button>Save draft</Button>
              <Button variant="ghost">Cancel</Button>
              <Button variant="danger">Write off</Button>
              <Button variant="primary" disabled>
                Submitting
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="sm">
                Assign
              </Button>
              <Button size="sm">Export CSV</Button>
              <Button variant="ghost" size="sm">
                Clear filters
              </Button>
            </div>
          </div>
        </Section>

        <Section
          title="Deadlines"
          description="Date, days remaining, and urgency. The due-soon window is a display setting, not a legal value."
        >
          <div className="flex flex-wrap gap-10">
            <DeadlineIndicator dueDate="2026-09-22" daysRemaining={-4} />
            <DeadlineIndicator dueDate="2026-09-26" daysRemaining={0} />
            <DeadlineIndicator dueDate="2026-10-01" daysRemaining={5} />
            <DeadlineIndicator dueDate="2026-11-09" daysRemaining={44} />
          </div>
        </Section>

        <Section title="Money" description="Integer cents in, tabular USD out, right-aligned in tables.">
          <div className="flex flex-wrap gap-10 text-title">
            <Money cents={124000} />
            <Money cents={-8950} />
            <Money cents={128_451_237} />
          </div>
        </Section>
      </Panel>
    </div>
  );
}
