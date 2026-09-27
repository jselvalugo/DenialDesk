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
import { regimeLabel } from "@/domain/denial-status";
import { clockDay, CLOCK_STATES, RESPONSE_KIND_LABEL_KEYS } from "@/domain/prompt-pay/clock";
import { getPromptPayClock } from "@/domain/prompt-pay/queries";
import type { MessageKey } from "@/i18n/messages/types";
import { getFormat, getT } from "@/i18n/server";
import { audit } from "@/lib/audit";
import { VoidResponseForm } from "./VoidResponseForm";

// The title never includes patient data (DESIGN.md §12).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("promptPay");
  return { title: t("detail.pageTitle") };
}

const MILESTONE_STATE_KEYS: Record<MilestoneState, { key: MessageKey<"promptPay">; tone: Tone }> = {
  met: { key: "milestoneState.met", tone: "success" },
  late: { key: "milestoneState.late", tone: "warning" },
  open: { key: "milestoneState.open", tone: "info" },
  overdue: { key: "milestoneState.overdue", tone: "danger" },
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
  const t = await getT("promptPay");
  const tc = await getT("common");
  const f = await getFormat();

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

  const subtitleParts = [
    claim.payerName,
    t("detail.claimLabel", { kind: claim.electronic ? t("detail.kind.electronic") : t("detail.kind.paper") }),
    claim.receivedDate ? t("detail.received", { date: f.date(claim.receivedDate) }) : null,
    day ? t("detail.day", { day: day.day }) : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <nav aria-label={t("nav.breadcrumb")} className="text-label text-muted">
        <Link href="/prompt-pay" className="font-medium text-link hover:underline">
          {t("detail.breadcrumbPromptPay")}
        </Link>{" "}
        <span aria-hidden>/</span> <span className="font-mono">{claim.claimNumber}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-6 rounded-panel border border-border bg-surface px-5 py-4 shadow-xs">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-[1.5rem] leading-8 font-bold text-primary">{claim.claimNumber}</h1>
            {state && <Badge tone={state.tone}>{t(state.labelKey)}</Badge>}
          </div>
          <p className="mt-1 text-body text-muted">{subtitleParts.join(" · ")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/claims/${claim.id}`}
            className="inline-flex h-8 items-center rounded-control border border-border-strong bg-surface px-3 text-body font-medium text-text hover:bg-surface-muted"
          >
            {t("detail.openClaim")}
          </Link>
          {canRecord && (
            <Link href={`/prompt-pay/${claim.id}/responses/new`} className={primaryLinkButtonClass}>
              {t("detail.recordContest")}
            </Link>
          )}
        </div>
      </header>

      {!clock?.applies ? (
        <Panel>
          <p className="text-body text-muted">
            {!claim.regime
              ? t("detail.noRegime")
              : claim.receivedDate
                ? t("detail.notCovered", { regime: regimeLabel(claim.regime, tc) })
                : t("detail.notReceived")}
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
                {t("detail.uncontestableAlert")}
              </p>
            )}
            <Panel
              title={t("detail.milestones.title")}
              description={t("detail.milestones.description")}
              flush
            >
              <Table caption={t("detail.milestones.caption")}>
                <thead>
                  <tr>
                    <Th>{t("table.milestone")}</Th>
                    <Th>{t("table.due")}</Th>
                    <Th>{t("table.metOn")}</Th>
                    <Th numeric>{t("table.daysLate")}</Th>
                    <Th>{t("table.state")}</Th>
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
                            <Badge tone="warning">{t("detail.milestones.pendingVerification")}</Badge>
                          </span>
                        )}
                      </Td>
                      <Td className="tabular">
                        {f.date(m.due)}
                        {m.daysRemaining !== null && m.state === "open" && (
                          <span className="block text-label text-muted">
                            {tc("deadline.left", { count: m.daysRemaining })}
                          </span>
                        )}
                      </Td>
                      <Td className="tabular">{m.metOn ? f.date(m.metOn) : "—"}</Td>
                      <Td numeric>{m.daysLate > 0 ? m.daysLate : "—"}</Td>
                      <Td>
                        <Badge tone={MILESTONE_STATE_KEYS[m.state].tone}>
                          {t(MILESTONE_STATE_KEYS[m.state].key)}
                        </Badge>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Panel>

            <Panel title={t("detail.interest.title")} description={t("detail.interest.description")} flush>
              {clock.interest.length === 0 ? (
                <p className="p-4 text-body text-muted">
                  {clock.paymentDue
                    ? t("detail.interest.noneWithDue", { date: f.date(clock.paymentDue) })
                    : t("detail.interest.noneNoDue")}
                </p>
              ) : (
                <Table caption={t("detail.interest.title")}>
                  <thead>
                    <tr>
                      <Th>{t("table.paymentDate")}</Th>
                      <Th>{t("table.dueDate")}</Th>
                      <Th numeric>{t("table.daysLate")}</Th>
                      <Th numeric>{t("table.paid")}</Th>
                      <Th numeric>{t("table.rate")}</Th>
                      <Th numeric>{t("table.interest")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {clock.interest.map((line) => (
                      <Tr key={`${line.paymentDate}-${line.paidCents}`}>
                        <Td className="tabular">{f.date(line.paymentDate)}</Td>
                        <Td className="tabular">{f.date(line.dueDate)}</Td>
                        <Td numeric>{line.daysLate}</Td>
                        <Td numeric>
                          <Money cents={line.paidCents} />
                        </Td>
                        <Td numeric>
                          {t("detail.interest.ratePerYear", { rate: f.decimal(line.ratePercent, 1) })}
                        </Td>
                        <Td numeric className="font-medium">
                          <Money cents={line.interestCents} />
                        </Td>
                      </Tr>
                    ))}
                    <Tr>
                      <Td colSpan={5} className="text-right font-medium">
                        {t("detail.interest.totalOwed")}
                      </Td>
                      <Td numeric className="font-bold">
                        <Money cents={clock.interestCents} />
                      </Td>
                    </Tr>
                  </tbody>
                </Table>
              )}
              <p className="border-t border-border px-4 py-2 text-label text-muted">
                {t("detail.interest.footnote")}
              </p>
            </Panel>
          </div>

          <div className="flex flex-col gap-6">
            <Panel title={t("detail.claim.title")}>
              <dl className="flex flex-col gap-3">
                <Field label={tc("word.patient")}>
                  <Link
                    href={`/patients/${claim.patientId}`}
                    className="font-medium text-link hover:underline"
                  >
                    {claim.patientLast}, {claim.patientFirst}
                  </Link>
                  <span className="block font-mono text-label text-muted">{claim.mrn}</span>
                </Field>
                <Field label={tc("word.payer")}>
                  {claim.payerName}
                  <span className="block text-label text-muted">{regimeLabel(claim.regime, tc)}</span>
                </Field>
                <Field label={tc("word.status")}>
                  <Badge tone={CLAIM_STATUSES[claim.status].tone}>
                    {tc(CLAIM_STATUSES[claim.status].labelKey)}
                  </Badge>
                </Field>
                <Field label={t("detail.claim.billedPaid")}>
                  <Money cents={claim.billedCents} /> / <Money cents={claim.paidCents} />
                </Field>
                {clock.providerResponseDue && (
                  <Field label={t("detail.claim.contestResponseDue")}>
                    <span className="tabular">{f.date(clock.providerResponseDue)}</span>
                  </Field>
                )}
              </dl>
            </Panel>

            <Panel title={t("detail.responses.title")} description={t("detail.responses.description")}>
              {history.length === 0 ? (
                <p className="text-body text-muted">{t("detail.responses.none")}</p>
              ) : (
                <ol className="flex flex-col divide-y divide-border" aria-label={t("detail.responses.title")}>
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
                            {entry.voidsResponseId ? t("detail.responses.recordedInError") : ""}
                            {t(RESPONSE_KIND_LABEL_KEYS[entry.kind])}
                          </span>
                          <span className="tabular text-muted">{f.date(entry.responseDate)}</span>
                          {entry.kind === "payment" && !entry.voidsResponseId && (
                            <Money cents={entry.cents} />
                          )}
                        </p>
                        <p className="mt-0.5 text-label text-muted">
                          {entry.remittanceId ? (
                            <>
                              {t("detail.responses.fromRemittance")}{" "}
                              <Link
                                href={`/remittances/${entry.remittanceId}`}
                                className="font-mono text-link hover:underline"
                              >
                                {entry.traceNumber}
                              </Link>{" "}
                              ·{" "}
                            </>
                          ) : null}
                          {entry.recordedByName ??
                            (entry.recordedBy
                              ? t("detail.responses.formerTeamMember")
                              : t("detail.responses.system"))}{" "}
                          · {f.dateTime(entry.createdAt)}
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
