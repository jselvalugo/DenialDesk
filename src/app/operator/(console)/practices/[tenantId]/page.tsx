import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { requireOperator } from "@/auth/operator";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { agreementStatus, listAgreements } from "@/domain/platform/agreements";
import { getPractice } from "@/domain/platform/practices";
import { auditSystem } from "@/lib/audit";
import { syntheticDataOnly } from "@/lib/env";
import { AgreementStatusBadge } from "../../AgreementStatusBadge";
import { RecordAgreementForm } from "./RecordAgreementForm";
import { VoidAgreementForm } from "./VoidAgreementForm";

export const metadata: Metadata = { title: "Practice" };

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "2-digit",
  day: "2-digit",
  year: "numeric",
  timeZone: "America/New_York",
});

/** A calendar date (YYYY-MM-DD) as MM/DD/YYYY without a time-zone shift. */
function calendarDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

const recordStatus = {
  active: { label: "Active", tone: "success" },
  superseded: { label: "Superseded", tone: "neutral" },
  historical: { label: "Historical", tone: "info" },
  voided: { label: "Recorded in error", tone: "danger" },
} as const;

function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

/** Operator's view of one practice: metadata and its agreements (docs/specs/practice-agreements.md). */
export default async function PracticePage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!z.uuid().safeParse(tenantId).success) notFound();
  const operator = await requireOperator();
  const practice = await getPractice(tenantId);
  if (!practice) notFound();
  await auditSystem({
    action: "operator.practice_viewed",
    actorUserId: operator.userId,
    tenantId,
    entityType: "tenant",
    entityId: tenantId,
  });

  const customer = practice.kind === "customer";
  const agreements = customer ? await listAgreements(tenantId) : [];
  const active = agreements.find((a) => a.status === "active") ?? null;
  const status = agreementStatus(agreements, todayIn());

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <PageHeader
        title={practice.name}
        description={
          customer ? "Customer practice. Practice-level details only." : "Demo practice on synthetic data."
        }
        actions={
          <Link href="/operator" className="text-body font-medium text-link hover:underline">
            All practices
          </Link>
        }
      />

      <Panel title="Practice">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
          <dt className="text-muted">Type</dt>
          <dd>
            <Badge tone={customer ? "neutral" : "info"} dot={false}>
              {customer ? "Customer" : "Demo"}
            </Badge>
          </dd>
          <dt className="text-muted">Status</dt>
          <dd>
            {practice.suspendedAt ? (
              <Badge tone={customer ? "danger" : "neutral"}>{customer ? "Suspended" : "Archived"}</Badge>
            ) : (
              <Badge tone="success">Active</Badge>
            )}
          </dd>
          <dt className="text-muted">Created</dt>
          <dd className="tabular">{dateFormat.format(practice.createdAt)}</dd>
          <dt className="text-muted">Team</dt>
          <dd className="tabular">{practice.teamSize}</dd>
        </dl>
      </Panel>

      {customer && (
        <>
          <Panel
            title="Business Associate Agreement"
            description="The signed agreement on file for this practice, and every earlier version."
            actions={<AgreementStatusBadge status={status} />}
            flush
          >
            {agreements.length === 0 ? (
              <p className="p-4 text-body text-muted">
                No agreement on file. Record the signed BAA below before this practice handles patient data.
              </p>
            ) : (
              <Table caption="Agreements on file">
                <thead>
                  <tr>
                    <Th>Status</Th>
                    <Th>Effective</Th>
                    <Th>Expires</Th>
                    <Th>Signed</Th>
                    <Th>Practice signer</Th>
                    <Th>DenialDesk signer</Th>
                    <Th>Recorded</Th>
                    <Th>File</Th>
                  </tr>
                </thead>
                <tbody>
                  {agreements.map((a) => (
                    <Tr key={a.id}>
                      <Td>
                        <Badge tone={recordStatus[a.status].tone}>{recordStatus[a.status].label}</Badge>
                      </Td>
                      <Td className="tabular">{calendarDate(a.effectiveDate)}</Td>
                      <Td className="tabular">
                        {a.expiresOn ? calendarDate(a.expiresOn) : "Until terminated"}
                      </Td>
                      <Td className="tabular">{calendarDate(a.signedOn)}</Td>
                      <Td>{a.practiceSigner}</Td>
                      <Td>{a.ourSigner}</Td>
                      <Td className="tabular text-muted">{dateFormat.format(a.createdAt)}</Td>
                      <Td>
                        <a
                          href={`/operator/practices/${tenantId}/agreements/${a.id}/download`}
                          className="font-medium text-link hover:underline"
                          title={`SHA-256 ${a.sha256}`}
                        >
                          {a.filename}
                        </a>
                        <span className="ml-2 text-label text-muted">{fileSize(a.sizeBytes)}</span>
                        {a.note && <p className="mt-0.5 text-label text-muted">{a.note}</p>}
                        {a.voidReason && (
                          <p className="mt-0.5 text-label text-danger-fg">
                            Recorded in error: {a.voidReason}
                          </p>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          <Panel
            title={active ? "Record a renewed agreement" : "Record the signed agreement"}
            description="Stored with the practice for the retention period; agreements are never edited or deleted."
          >
            <div className="max-w-3xl">
              <RecordAgreementForm
                tenantId={tenantId}
                hasActive={active !== null}
                syntheticOnly={syntheticDataOnly()}
              />
            </div>
          </Panel>

          {agreements.some((a) => a.status !== "voided") && (
            <Panel
              title="Correct the record"
              description="A wrong upload or a typo can't be edited. Mark the agreement as recorded in error, then record the correct one; both stay on file."
            >
              <div className="max-w-3xl">
                <VoidAgreementForm
                  tenantId={tenantId}
                  agreements={agreements
                    .filter((a) => a.status !== "voided")
                    .map((a) => ({
                      id: a.id,
                      label: `${a.filename} · effective ${calendarDate(a.effectiveDate)} · ${recordStatus[a.status].label}`,
                    }))}
                />
              </div>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
