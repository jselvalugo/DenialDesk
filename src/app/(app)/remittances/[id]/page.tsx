import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { canPostRemittances, canVoidRemittances } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { Money } from "@/components/ui/Money";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { CATEGORY_LABEL_KEYS } from "@/domain/carc";
import { DENIAL_STATUSES } from "@/domain/denial-status";
import { getRemittance } from "@/domain/remittances/queries";
import {
  CLP_STATUS_LABEL_KEYS,
  isBalanced,
  METHOD_LABEL_KEYS,
  REMITTANCE_STATUSES,
} from "@/domain/remittances/status";
import { getFormat, getT } from "@/i18n/server";
import { audit } from "@/lib/audit";
import { RemittanceActions } from "./RemittanceActions";

// The title never includes patient data (DESIGN.md §12).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("remittances");
  return { title: t("detail.pageTitle") };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-label font-medium text-muted">{label}</dt>
      <dd className="text-body text-text">{children}</dd>
    </div>
  );
}

export default async function RemittancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const auth = await requireAuth();
  const t = await getT("remittances");
  const tc = await getT("common");
  const f = await getFormat();

  const detail = await withTenant(auth, async (tx) => {
    const detail = await getRemittance(tx, id);
    if (!detail) return null;
    await audit(tx, {
      action: "remittance.viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      entityType: "remittance",
      entityId: id,
      // Whose records were shown, for accounting of disclosures (IDs only).
      metadata: { patientIds: [...new Set(detail.lines.map((l) => l.patientId))].join(",") },
    });
    return detail;
  });
  if (!detail) notFound();

  const { remittance, lines, history } = detail;
  const status = REMITTANCE_STATUSES[remittance.status];
  const claimsPaid = lines.reduce((sum, l) => sum + l.paidCents, 0);
  const balanced = isBalanced({
    totalPaidCents: remittance.totalPaidCents,
    providerAdjustmentCents: remittance.providerAdjustmentCents,
    claimsPaidCents: claimsPaid,
  });
  const ready = remittance.status === "received";
  const canPost = ready && canPostRemittances(auth.role);
  const canVoid = ready && canVoidRemittances(auth.role);
  const eventLabelKeys = { received: "event.received", posted: "event.posted", void: "event.void" } as const;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <nav aria-label={t("nav.breadcrumb")} className="text-label text-muted">
        <Link href="/remittances" className="font-medium text-link hover:underline">
          {t("detail.breadcrumbRemittances")}
        </Link>{" "}
        <span aria-hidden>/</span> <span className="font-mono">{remittance.traceNumber}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-6 rounded-panel border border-border bg-surface px-5 py-4 shadow-xs">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-[1.5rem] leading-8 font-bold text-primary">
              {remittance.traceNumber}
            </h1>
            <Badge tone={status.tone}>{t(status.labelKey)}</Badge>
          </div>
          <p className="mt-1 text-body text-muted">
            {detail.payerName} · {t(METHOD_LABEL_KEYS[remittance.method])} · {f.date(remittance.paymentDate)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-label font-medium text-muted">{t("detail.totalPaid")}</p>
          <Money cents={remittance.totalPaidCents} className="text-[1.5rem] leading-8 font-bold" />
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] items-start gap-6">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title={t("detail.payment.title")} flush>
            <dl className="grid grid-cols-4 gap-x-6 gap-y-4 p-4">
              <Field label={tc("word.payer")}>
                {detail.payerName}
                <span className="block font-mono text-label text-muted">
                  {t("detail.field.ediId", { ediId: detail.payerEdiId ?? "—" })}
                </span>
              </Field>
              <Field label={t("detail.field.method")}>{t(METHOD_LABEL_KEYS[remittance.method])}</Field>
              <Field label={t("detail.field.traceNumber")}>
                <span className="font-mono">{remittance.traceNumber}</span>
              </Field>
              <Field label={t("detail.field.paymentDate")}>
                <span className="tabular">{f.date(remittance.paymentDate)}</span>
              </Field>
              <Field label={t("detail.field.claimsPaid")}>
                <Money cents={claimsPaid} />
              </Field>
              <Field label={t("detail.field.providerAdjustments")}>
                <Money cents={remittance.providerAdjustmentCents} />
              </Field>
              <Field label={t("detail.field.balanceCheck")}>
                {balanced ? (
                  <Badge tone="success">{t("detail.balances")}</Badge>
                ) : (
                  <Badge tone="danger">{t("detail.doesNotBalance")}</Badge>
                )}
              </Field>
              <Field label={t("detail.field.loadedBy")}>
                {detail.loadedByName ??
                  (remittance.loadedBy ? t("detail.formerTeamMember") : t("detail.system"))}
                <span className="block text-label text-muted">{f.dateTime(remittance.createdAt)}</span>
              </Field>
            </dl>
          </Panel>

          <Panel
            title={t("detail.claimPayments.title")}
            description={t("detail.claimPayments.description")}
            flush
          >
            <Table caption={t("detail.claimPayments.title")}>
              <thead>
                <tr>
                  <Th>{tc("word.claim")}</Th>
                  <Th>{tc("word.patient")}</Th>
                  <Th>{t("detail.table.payerStatus")}</Th>
                  <Th numeric>{t("detail.table.charge")}</Th>
                  <Th numeric>{t("detail.table.paid")}</Th>
                  <Th numeric>{t("detail.table.patientOwes")}</Th>
                  <Th>{t("detail.table.adjustments")}</Th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <Tr key={line.id}>
                    <Td>
                      <Link
                        href={`/claims/${line.claimId}`}
                        className="font-mono text-label font-medium whitespace-nowrap text-link hover:underline"
                      >
                        {line.claimNumber}
                      </Link>
                      {line.payerControlNumber && (
                        <span className="block font-mono text-label text-muted">
                          {t("detail.icn", { number: line.payerControlNumber })}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Link
                        href={`/patients/${line.patientId}`}
                        className="block font-medium text-link hover:underline"
                      >
                        {line.patientLast}, {line.patientFirst.charAt(0)}.
                      </Link>
                      <span className="block font-mono text-label text-muted">{line.mrn}</span>
                    </Td>
                    <Td>
                      <span className="block">
                        {t(CLP_STATUS_LABEL_KEYS[line.statusCode] ?? "clpStatus.other")}
                      </span>
                      <span className="block font-mono text-label text-muted">CLP02 {line.statusCode}</span>
                    </Td>
                    <Td numeric>
                      <Money cents={line.chargeCents} />
                    </Td>
                    <Td numeric className="font-medium">
                      <Money cents={line.paidCents} />
                    </Td>
                    <Td numeric>
                      <Money cents={line.patientResponsibilityCents} />
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {line.adjustments.length === 0 && <span className="text-muted">—</span>}
                        {line.adjustments.map((a) => (
                          <Code key={`${a.group}-${a.carc}`}>
                            {a.group}-{a.carc} {(a.cents / 100).toFixed(2)}
                          </Code>
                        ))}
                        {line.rarcs.map((r) => (
                          <Code key={r}>RARC {r}</Code>
                        ))}
                      </span>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          {ready && (canPost || canVoid) && (
            <Panel title={t("detail.actions.title")}>
              <RemittanceActions
                remittanceId={remittance.id}
                canPost={canPost}
                canVoid={canVoid}
                balanced={balanced}
              />
            </Panel>
          )}
          {ready && !canPost && !canVoid && (
            <Panel title={t("detail.actions.title")}>
              <p className="text-body text-muted">{t("detail.actions.forbidden")}</p>
            </Panel>
          )}
          {detail.captured.length > 0 && (
            <Panel
              title={t("detail.denialsCaptured.title")}
              description={t("detail.denialsCaptured.description")}
            >
              <ul className="flex flex-col gap-3">
                {detail.captured.map((d) => (
                  <li key={d.id} className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <Link href={`/denials/${d.id}`} className="font-medium text-link hover:underline">
                        {tc(CATEGORY_LABEL_KEYS[d.category])}
                      </Link>
                      <span className="block font-mono text-label text-muted">
                        {d.claimNumber} · {d.groupCode}-{d.carc}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <Money cents={d.deniedCents} className="block" />
                      <Badge tone={DENIAL_STATUSES[d.status].tone}>
                        {tc(DENIAL_STATUSES[d.status].labelKey)}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <Panel title={t("detail.history.title")} description={t("detail.history.description")}>
            <ol className="flex flex-col divide-y divide-border" aria-label={t("detail.history.listLabel")}>
              {history.map((entry) => (
                <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-label text-muted">
                    <span className="font-medium text-text">{t(eventLabelKeys[entry.event])}</span> ·{" "}
                    {entry.actor ?? (entry.actorId ? t("detail.formerTeamMember") : t("detail.system"))} ·{" "}
                    {f.dateTime(entry.createdAt)}
                  </p>
                  <p className="mt-1 text-body whitespace-pre-wrap text-text">{entry.reason}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}
