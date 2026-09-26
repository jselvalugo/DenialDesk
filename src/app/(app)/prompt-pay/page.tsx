import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { DeadlineIndicator } from "@/components/ui/DeadlineIndicator";
import { EmptyState } from "@/components/ui/EmptyState";
import { linkButtonReset } from "@/components/ui/linkButton";
import { Money } from "@/components/ui/Money";
import { PageHeader } from "@/components/ui/PageHeader";
import { pageCount, Pagination } from "@/components/ui/Pagination";
import { Panel } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { StatTile } from "@/components/ui/StatTile";
import { withTenant } from "@/db/tenant";
import { payerOptions } from "@/domain/denials/queries";
import { CLOCK_STATES, PROMPT_PAY_ALERT_DAYS, PROMPT_PAY_DUE_SOON_DAYS } from "@/domain/prompt-pay/clock";
import {
  PROMPT_PAY_LIMIT,
  PROMPT_PAY_PAGE_SIZE,
  promptPayOverview,
  type PromptPayFilters,
} from "@/domain/prompt-pay/queries";
import { audit } from "@/lib/audit";
import { formatCents, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Prompt pay" };

const schema = z.object({
  state: z.enum(["open", "met", "late", "uncontestable", "due_soon"]).optional().catch(undefined),
  payer: z.uuid().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

function parseFilters(params: Record<string, string | string[] | undefined>): PromptPayFilters {
  const flat = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined]),
  );
  const parsed = schema.parse(flat);
  return { state: parsed.state, payerId: parsed.payer, page: parsed.page };
}

function toQuery(filters: PromptPayFilters, page = filters.page): string {
  const query = new URLSearchParams();
  if (filters.state) query.set("state", filters.state);
  if (filters.payerId) query.set("payer", filters.payerId);
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `?${text}` : "";
}

export default async function PromptPayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const filters = parseFilters(await searchParams);
  const today = todayIn();

  const { rows, total, summary, truncated, payers } = await withTenant(auth, async (tx) => {
    const overview = await promptPayOverview(tx, filters, today);
    const payers = await payerOptions(tx);
    await audit(tx, {
      action: "prompt_pay.list_viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      metadata: {
        claimIds: overview.rows.map((row) => row.id).join(","),
        count: overview.rows.length,
        page: filters.page,
      },
    });
    return { ...overview, payers };
  });

  const pages = pageCount(total, PROMPT_PAY_PAGE_SIZE);
  if (total > 0 && filters.page > pages) redirect(`/prompt-pay${toQuery(filters, pages)}`);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader
        title="Prompt pay"
        description="Florida prompt-pay clocks from the payer's receipt date: what the payer owes and when, missed milestones, and interest."
      />

      <section aria-label="Prompt-pay totals" className="grid grid-cols-5 gap-4">
        <StatTile
          label="Open clocks"
          value={summary.open.toLocaleString("en-US")}
          detail="Awaiting payment or denial"
        />
        <StatTile
          label={`Due in ${PROMPT_PAY_DUE_SOON_DAYS} days`}
          value={summary.dueSoon}
          emphasis={summary.dueSoon > 0 ? "warning" : undefined}
          detail="Next payer milestone"
        />
        <StatTile
          label="Payer late"
          value={summary.late}
          emphasis={summary.late > 0 ? "warning" : undefined}
          detail="Missed a milestone"
        />
        <StatTile
          label="Uncontestable"
          value={summary.uncontestable}
          emphasis={summary.uncontestable > 0 ? "danger" : undefined}
          detail="Not paid or denied in time"
        />
        <StatTile
          label="Interest owed"
          value={formatCents(summary.interestCents)}
          detail="On late payments"
        />
      </section>

      <Panel flush>
        <form method="get" className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
          <Select
            label="Clock"
            name="state"
            defaultValue={filters.state ?? ""}
            options={[
              { value: "", label: "All" },
              { value: "due_soon", label: `Due in ${PROMPT_PAY_DUE_SOON_DAYS} days` },
              { value: "open", label: CLOCK_STATES.open.label },
              { value: "late", label: CLOCK_STATES.late.label },
              { value: "uncontestable", label: CLOCK_STATES.uncontestable.label },
              { value: "met", label: CLOCK_STATES.met.label },
            ]}
          />
          <Select
            label="Payer"
            name="payer"
            defaultValue={filters.payerId ?? ""}
            options={[
              { value: "", label: "All payers" },
              ...payers.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <div className="flex gap-2">
            <Button type="submit" size="md">
              Apply
            </Button>
            <Link href="/prompt-pay" className={linkButtonReset}>
              Reset
            </Link>
          </div>
        </form>

        {truncated && (
          <p
            role="note"
            className="border-b border-border bg-warning-bg px-4 py-2 text-label text-warning-fg"
          >
            More than {PROMPT_PAY_LIMIT.toLocaleString("en-US")} received claims: the list and totals cover
            the most recently received ones only.
          </p>
        )}

        {rows.length === 0 ? (
          <EmptyState
            title={
              filters.state || filters.payerId ? "No clocks match these filters" : "No prompt-pay clocks"
            }
            description="A clock starts when a payer covered by Florida prompt pay confirms it received a claim."
          />
        ) : (
          <Table caption="Prompt-pay clocks">
            <thead>
              <tr>
                <Th>Claim</Th>
                <Th>Patient</Th>
                <Th>Payer</Th>
                <Th>Received</Th>
                <Th>Clock day</Th>
                <Th aria-sort="ascending">Next milestone</Th>
                <Th numeric>Paid</Th>
                <Th numeric>Interest</Th>
                <Th>State</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const state = CLOCK_STATES[row.clock.state];
                const next = row.clock.nextDue;
                return (
                  <Tr key={row.id}>
                    <Td>
                      <Link
                        href={`/prompt-pay/${row.id}`}
                        className="font-mono text-label font-medium whitespace-nowrap text-link hover:underline"
                      >
                        {row.claimNumber}
                      </Link>
                    </Td>
                    <Td>
                      <Link
                        href={`/patients/${row.patientId}`}
                        className="block font-medium text-link hover:underline"
                      >
                        {row.patientLast}, {row.patientFirst.charAt(0)}.
                      </Link>
                      <span className="block font-mono text-label text-muted">{row.mrn}</span>
                    </Td>
                    <Td>
                      <span className="block">{row.payerName}</span>
                      <span className="block text-label text-muted">
                        {row.electronic ? "Electronic" : "Paper"}
                      </span>
                    </Td>
                    <Td className="tabular">{formatDate(row.receivedDate!)}</Td>
                    <Td className="tabular">
                      Day {row.day.day}
                      {row.day.alert !== null && (
                        <span className="block text-label font-medium text-warning-fg">
                          Day {row.day.alert} alert
                        </span>
                      )}
                    </Td>
                    <Td>
                      {next && next.daysRemaining !== null ? (
                        <>
                          <DeadlineIndicator
                            dueDate={next.due}
                            daysRemaining={next.daysRemaining}
                            dueSoonDays={PROMPT_PAY_DUE_SOON_DAYS}
                          />
                          <span className="block text-label text-muted">{next.title}</span>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                    <Td numeric>
                      <Money cents={row.paidCents} />
                    </Td>
                    <Td numeric className="font-medium">
                      {row.clock.interestCents > 0 ? <Money cents={row.clock.interestCents} /> : "—"}
                    </Td>
                    <Td>
                      <Badge tone={state.tone}>{state.label}</Badge>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}

        <Pagination
          page={filters.page}
          pageSize={PROMPT_PAY_PAGE_SIZE}
          total={total}
          hrefFor={(page) => `/prompt-pay${toQuery(filters, page)}`}
        />
      </Panel>
      <p className="text-label text-muted">
        Milestones and the interest rate come from the rules engine and are pending Florida counsel
        verification. Alert days ({PROMPT_PAY_ALERT_DAYS.join(", ")}) are a practice setting.
      </p>
    </div>
  );
}
