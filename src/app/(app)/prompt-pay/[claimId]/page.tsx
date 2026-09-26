import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import type { MilestoneState } from "@rules/prompt-pay";
import { canRecordPromptPay } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { Money } from "@/components/ui/Money";
import { Panel } from "@/components/ui/Panel";
import { primaryLinkButtonClass } from "@/components/ui/linkButton";
import { withTenant } from "@/db/tenant";
import { CLAIM_STATUSES } from "@/domain/claims/status";
import { REGIME_LABELS } from "@/domain/denial-status";
import { clockDay, CLOCK_STATES, RESPONSE_KIND_LABELS } from "@/domain/prompt-pay/clock";
import { getPromptPayClock } from "@/domain/prompt-pay/queries";
import { audit } from "@/lib/audit";
import { formatDate, formatDateTime } from "@/lib/format";
import { VoidResponseForm } from "./VoidResponseForm";

// The title never includes patient data (DESIGN.md §12).
export const metadata: Metadata = { title: "Prompt-pay clock" };

const MILESTONE_STATES: Record<MilestoneState, { label: string; tone: Tone }> = {
  met: { label: "Met", tone: "success" },
  late: { label: "Met late", tone: "warning" },
  open: { label: "Open", tone: "info" },
  overdue: { label: "Missed", tone: "danger" },
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-label font-medium text-muted">{label}</dt>
      <dd className="text-body text-text">{children}</dd>
    </div>
  );
}

export default async function PromptPayClockPage({ params }: { params: Promise<{ claimId: string }> }) {
  const { claimId } = await params;
  if (!z.uuid().safeParse(claimId).success) notFound();
  const auth = await requireAuth();
  const today = todayIn();

  const detail = await withTenant(auth, async (tx) => {
    const detail = await getPromptPayClock(tx, claimId, today);
    if (!detail) return null;
    await audit(tx, {
      action: "prompt_pay.viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "claim",
      entityId: claimId,
      metadata: { patientId: detail.claim.patientId },
    });
    return detail;
  });
  if (!detail) notFound();

  const { claim, clock, history } = detail;
  const voided = new Set(history.flatMap((h) => (h.voidsResponseId ? [h.voidsResponseId] : [])));
  const canRecord = canRecordPromptPay(auth.role) && Boolean(clock?.applies);
  const state = clock?.applies ? CLOCK_STATES[clock.state] : null;
  const day = clock?.applies ? clockDay(clock.receivedDate, today, clock.state !== "met") : null;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-label text-muted">
        <Link href="/prompt-pay" className="font-medium text-link hover:underline">
          Prompt pay
        </Link>{" "}
        <span aria-hidden>/</span> <span className="font-mono">{claim.claimNumber}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-6 rounded-panel border border-border bg-surface px-5 py-4 shadow-xs">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-[1.5rem] leading-8 font-bold text-primary">{claim.claimNumber}</h1>
            {state && <Badge tone={state.tone}>{state.label}</Badge>}
          </div>
          <p className="mt-1 text-body text-muted">
            {claim.payerName} · {claim.electronic ? "electronic" : "paper"} claim
            {claim.receivedDate ? ` · received ${formatDate(claim.receivedDate)}` : ""}
            {day ? ` · day ${day.day}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/claims/${claim.id}`}
            className="inline-flex h-8 items-center rounded-control border border-border-strong bg-surface px-3 text-body font-medium text-text hover:bg-surface-muted"
          >
            Open claim
          </Link>
          {canRecord && (
            <Link href={`/prompt-pay/${claim.id}/responses/new`} className={primaryLinkButtonClass}>
              Record contest
            </Link>
          )}
        </div>
      </header>

      {!clock?.applies ? (
        <Panel>
          <p className="text-body text-muted">
            {claim.receivedDate
              ? `Florida prompt pay doesn't cover ${REGIME_LABELS[claim.regime]} claims, so this claim has no clock.`
              : "The payer hasn't confirmed receipt of this claim, so its prompt-pay clock hasn't started."}
          </p>
        </Panel>
      ) : (
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] items-start gap-6">
          <div className="flex min-w-0 flex-col gap-6">
            {clock.uncontestable && (
              <p
                role="alert"
                className="rounded-panel border border-danger-border bg-danger-bg px-4 py-3 text-body text-danger-fg"
              >
                The payer neither paid nor denied this claim by the uncontestable milestone. Payment may now
                be an uncontestable obligation (R-3.1.4). Confirm with counsel before sending a demand.
              </p>
            )}
            <Panel
              title="Milestones"
              description="Counted in calendar days from the payer's receipt date."
              flush
            >
              <Table caption="Prompt-pay milestones">
                <thead>
                  <tr>
                    <Th>Milestone</Th>
                    <Th>Due</Th>
                    <Th>Met on</Th>
                    <Th numeric>Days late</Th>
                    <Th>State</Th>
                  </tr>
                </thead>
                <tbody>
                  {clock.milestones.map((m) => (
                    <Tr key={m.ruleId}>
                      <Td>
                        <span className="block font-medium">{m.title}</span>
                        <span className="block text-label text-muted">{m.citation}</span>
                        {m.verify && (
                          <span className="mt-1 inline-block">
                            <Badge tone="warning">Pending counsel verification</Badge>
                          </span>
                        )}
                      </Td>
                      <Td className="tabular">
                        {formatDate(m.due)}
                        {m.daysRemaining !== null && m.state === "open" && (
                          <span className="block text-label text-muted">{m.daysRemaining} days left</span>
                        )}
                      </Td>
                      <Td className="tabular">{m.metOn ? formatDate(m.metOn) : "—"}</Td>
                      <Td numeric>{m.daysLate > 0 ? m.daysLate : "—"}</Td>
                      <Td>
                        <Badge tone={MILESTONE_STATES[m.state].tone}>{MILESTONE_STATES[m.state].label}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Panel>

            <Panel
              title="Interest worksheet"
              description="Simple interest on each payment made after payment was due (R-3.1.3)."
              flush
            >
              {clock.interest.length === 0 ? (
                <p className="p-4 text-body text-muted">
                  {clock.paymentDue
                    ? `No late payments. Payment is due by ${formatDate(clock.paymentDue)}.`
                    : "No payments yet."}
                </p>
              ) : (
                <Table caption="Interest worksheet">
                  <thead>
                    <tr>
                      <Th>Payment date</Th>
                      <Th>Due date</Th>
                      <Th numeric>Days late</Th>
                      <Th numeric>Paid</Th>
                      <Th numeric>Rate</Th>
                      <Th numeric>Interest</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {clock.interest.map((line) => (
                      <Tr key={`${line.paymentDate}-${line.paidCents}`}>
                        <Td className="tabular">{formatDate(line.paymentDate)}</Td>
                        <Td className="tabular">{formatDate(line.dueDate)}</Td>
                        <Td numeric>{line.daysLate}</Td>
                        <Td numeric>
                          <Money cents={line.paidCents} />
                        </Td>
                        <Td numeric>{line.ratePercent}% / yr</Td>
                        <Td numeric className="font-medium">
                          <Money cents={line.interestCents} />
                        </Td>
                      </Tr>
                    ))}
                    <Tr>
                      <Td colSpan={5} className="text-right font-medium">
                        Total interest owed
                      </Td>
                      <Td numeric className="font-bold">
                        <Money cents={clock.interestCents} />
                      </Td>
                    </Tr>
                  </tbody>
                </Table>
              )}
              <p className="border-t border-border px-4 py-2 text-label text-muted">
                Interest starts the day after payment was due (the pay-or-contest date, or the pay-or-deny
                date once the payer contests). Pending counsel verification.
              </p>
            </Panel>
          </div>

          <div className="flex flex-col gap-6">
            <Panel title="Claim">
              <dl className="flex flex-col gap-3">
                <Field label="Patient">
                  <Link
                    href={`/patients/${claim.patientId}`}
                    className="font-medium text-link hover:underline"
                  >
                    {claim.patientLast}, {claim.patientFirst}
                  </Link>
                  <span className="block font-mono text-label text-muted">{claim.mrn}</span>
                </Field>
                <Field label="Payer">
                  {claim.payerName}
                  <span className="block text-label text-muted">{REGIME_LABELS[claim.regime]}</span>
                </Field>
                <Field label="Status">
                  <Badge tone={CLAIM_STATUSES[claim.status].tone}>{CLAIM_STATUSES[claim.status].label}</Badge>
                </Field>
                <Field label="Billed / paid">
                  <Money cents={claim.billedCents} /> / <Money cents={claim.paidCents} />
                </Field>
                {clock.providerResponseDue && (
                  <Field label="Your response to the contest is due">
                    <span className="tabular">{formatDate(clock.providerResponseDue)}</span>
                  </Field>
                )}
              </dl>
            </Panel>

            <Panel
              title="Payer responses"
              description="Every response on this clock. Entries are never edited or deleted."
            >
              {history.length === 0 ? (
                <p className="text-body text-muted">No payment, denial, or contest recorded yet.</p>
              ) : (
                <ol className="flex flex-col divide-y divide-border" aria-label="Payer responses">
                  {history.map((entry) => {
                    const struck = voided.has(entry.id);
                    return (
                      <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
                        <p className="flex flex-wrap items-center gap-2 text-body">
                          <span
                            className={
                              struck ? "font-medium text-muted line-through" : "font-medium text-text"
                            }
                          >
                            {entry.voidsResponseId ? "Recorded in error: " : ""}
                            {RESPONSE_KIND_LABELS[entry.kind]}
                          </span>
                          <span className="tabular text-muted">{formatDate(entry.responseDate)}</span>
                          {entry.kind === "payment" && !entry.voidsResponseId && (
                            <Money cents={entry.cents} />
                          )}
                        </p>
                        <p className="mt-0.5 text-label text-muted">
                          {entry.remittanceId ? (
                            <>
                              From remittance{" "}
                              <Link
                                href={`/remittances/${entry.remittanceId}`}
                                className="font-mono text-link hover:underline"
                              >
                                {entry.traceNumber}
                              </Link>{" "}
                              ·{" "}
                            </>
                          ) : null}
                          {entry.recordedByName ?? (entry.recordedBy ? "Former team member" : "System")} ·{" "}
                          {formatDateTime(entry.createdAt)}
                        </p>
                        {entry.note && (
                          <p className="mt-1 text-body whitespace-pre-wrap text-text">{entry.note}</p>
                        )}
                        {canRecord && entry.kind === "contest" && !entry.voidsResponseId && !struck && (
                          <VoidResponseForm responseId={entry.id} />
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
