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
import { agreementStatus, listAgreements, type AgreementStatus } from "@/domain/platform/agreements";
import { getPractice } from "@/domain/platform/practices";
import { getFormat, getT } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages/types";
import { auditSystem } from "@/lib/audit";
import { syntheticDataOnly } from "@/lib/env";
import { AgreementStatusBadge } from "../../AgreementStatusBadge";
import { RecordAgreementForm } from "./RecordAgreementForm";
import { VoidAgreementForm } from "./VoidAgreementForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("operator");
  return { title: t("practice.metaTitle") };
}

function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

type RecordStatus = "active" | "superseded" | "historical" | "voided";

const recordStatusKeys: Record<
  RecordStatus,
  { labelKey: MessageKey<"operator">; tone: "success" | "neutral" | "info" | "danger" }
> = {
  active: { labelKey: "status.active", tone: "success" },
  superseded: { labelKey: "recordStatus.superseded", tone: "neutral" },
  historical: { labelKey: "recordStatus.historical", tone: "info" },
  voided: { labelKey: "recordStatus.voided", tone: "danger" },
};

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

  const t = await getT("operator");
  const tc = await getT("common");
  const f = await getFormat();

  const customer = practice.kind === "customer";
  const agreements = customer ? await listAgreements(tenantId) : [];
  const active = agreements.find((a) => a.status === "active") ?? null;
  const status: AgreementStatus = agreementStatus(agreements, todayIn());

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <PageHeader
        title={practice.name}
        description={customer ? t("practice.descriptionCustomer") : t("practice.descriptionDemo")}
        actions={
          <Link href="/operator" className="text-body font-medium text-link hover:underline">
            {t("nav.allPractices")}
          </Link>
        }
      />

      <Panel title={t("practice.panelTitle")}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-body">
          <dt className="text-muted">{tc("word.type")}</dt>
          <dd>
            <Badge tone={customer ? "neutral" : "info"} dot={false}>
              {customer ? t("status.customer") : t("status.demo")}
            </Badge>
          </dd>
          <dt className="text-muted">{tc("word.status")}</dt>
          <dd>
            {practice.suspendedAt ? (
              <Badge tone={customer ? "danger" : "neutral"}>
                {customer ? t("status.suspended") : t("status.archived")}
              </Badge>
            ) : (
              <Badge tone="success">{t("status.active")}</Badge>
            )}
          </dd>
          <dt className="text-muted">{tc("word.created")}</dt>
          <dd className="tabular">{f.dateTime(practice.createdAt)}</dd>
          <dt className="text-muted">{t("list.columns.team")}</dt>
          <dd className="tabular">{f.number(practice.teamSize)}</dd>
        </dl>
      </Panel>

      {customer && (
        <>
          <Panel
            title={t("practice.baaTitle")}
            description={t("practice.baaDescription")}
            actions={<AgreementStatusBadge status={status} />}
            flush
          >
            {agreements.length === 0 ? (
              <p className="p-4 text-body text-muted">{t("practice.noAgreement")}</p>
            ) : (
              <Table caption={t("practice.tableCaption")}>
                <thead>
                  <tr>
                    <Th>{tc("word.status")}</Th>
                    <Th>{t("practice.columns.effective")}</Th>
                    <Th>{t("practice.columns.expires")}</Th>
                    <Th>{t("practice.columns.signed")}</Th>
                    <Th>{t("practice.columns.practiceSigner")}</Th>
                    <Th>{t("practice.columns.ourSigner")}</Th>
                    <Th>{t("practice.columns.recorded")}</Th>
                    <Th>{t("practice.columns.file")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {agreements.map((a) => {
                    const recordStatus = recordStatusKeys[a.status];
                    return (
                      <Tr key={a.id}>
                        <Td>
                          <Badge tone={recordStatus.tone}>{t(recordStatus.labelKey)}</Badge>
                        </Td>
                        <Td className="tabular">{f.date(a.effectiveDate)}</Td>
                        <Td className="tabular">
                          {a.expiresOn ? f.date(a.expiresOn) : t("practice.untilTerminated")}
                        </Td>
                        <Td className="tabular">{f.date(a.signedOn)}</Td>
                        <Td>{a.practiceSigner}</Td>
                        <Td>{a.ourSigner}</Td>
                        <Td className="tabular text-muted">{f.dateTime(a.createdAt)}</Td>
                        <Td>
                          <a
                            href={`/operator/practices/${tenantId}/agreements/${a.id}/download`}
                            className="font-medium text-link hover:underline"
                            title={t("practice.fileHashTitle", { sha: a.sha256 })}
                          >
                            {a.filename}
                          </a>
                          <span className="ml-2 text-label text-muted">{fileSize(a.sizeBytes)}</span>
                          {a.note && <p className="mt-0.5 text-label text-muted">{a.note}</p>}
                          {a.voidReason && (
                            <p className="mt-0.5 text-label text-danger-fg">
                              {t("practice.voidedNote", { reason: a.voidReason })}
                            </p>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Panel>

          <Panel
            title={active ? t("practice.recordTitleRenew") : t("practice.recordTitleNew")}
            description={t("practice.recordDescription")}
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
            <Panel title={t("practice.correctTitle")} description={t("practice.correctDescription")}>
              <div className="max-w-3xl">
                <VoidAgreementForm
                  tenantId={tenantId}
                  agreements={agreements
                    .filter((a) => a.status !== "voided")
                    .map((a) => ({
                      id: a.id,
                      label: t("voidForm.optionLabel", {
                        filename: a.filename,
                        date: f.date(a.effectiveDate),
                        status: t(recordStatusKeys[a.status].labelKey),
                      }),
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
