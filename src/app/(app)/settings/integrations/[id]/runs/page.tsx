import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { canManageIntegrations } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { getConnection } from "@/domain/integrations/connections";
import { issueCodeLabelKey, runCodeLabelKeys } from "@/domain/integrations/sync-codes";
import {
  auditSyncRunViewed,
  getSyncRunIssues,
  listSyncRuns,
  MAX_SYNC_ISSUES_SHOWN,
  SYNC_RUN_STATUS_LABEL_KEYS,
  SYNC_RUN_STATUS_TONE,
  SYNC_RUNS_PAGE_SIZE,
} from "@/domain/integrations/sync-history";
import { getFormat, getT } from "@/i18n/server";
import { integrationActor } from "../../form-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("integrations");
  return { title: t("runs.metaTitle") };
}

/** A positive whole page number from the query string; anything else is page 1. */
function pageNumber(value: string | undefined): number {
  return /^\d{1,6}$/.test(value ?? "") ? Math.max(1, Number(value)) : 1;
}

/**
 * Sync history for one connection (docs/specs/patient-integrations.md PI2b): every run, newest
 * first, as counts and codes, and, for one run, its issue rows, each linking to the DenialDesk
 * patient. Administrators only (anyone else gets a 404, as on the connection page). Nothing on the
 * page is a name or an identifier: a run holds counts, a status, times, an HTTP status, and issue
 * codes; an issue row holds a code and a link to the DenialDesk patient. No name, MRN, external ID,
 * or URL is selected (`src/domain/integrations/sync-history.ts`), and a stored code is shown only
 * through the fixed allow-list in `sync-codes.ts` (translated; anything else reads "Other", never the
 * raw string). The run list is not audited (counts and codes); opening one run's issue rows is
 * (`integration.sync_run_viewed`: run ID and row count).
 */
export default async function SyncHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; run?: string }>;
}) {
  const auth = await requireAuth();
  if (!canManageIntegrations(auth.role)) notFound();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const actor = integrationActor(auth);
  const query = await searchParams;
  const requestedPage = pageNumber(query.page);
  const selectedRun = z.uuid().safeParse(query.run ?? "");

  const loaded = await withTenant(auth, async (tx) => {
    const connection = await getConnection(tx, id.data);
    if (!connection) return null;
    const history = await listSyncRuns(tx, id.data, requestedPage);
    const detail = selectedRun.success ? await getSyncRunIssues(tx, id.data, selectedRun.data) : null;
    // The run's detail is a read of per-patient rows: audited with the run ID and the row count only.
    if (selectedRun.success && detail) {
      await auditSyncRunViewed(tx, actor, id.data, selectedRun.data, detail.issues.length);
    }
    return { connection, history, detail };
  });
  if (!loaded) notFound();
  const { connection, history, detail } = loaded;

  const t = await getT("integrations");
  const ts = await getT("settings");
  const f = await getFormat();
  const hrefFor = (target: number, run?: string) => {
    const search = new URLSearchParams();
    if (target > 1) search.set("page", String(target));
    if (run) search.set("run", run);
    const qs = search.toString();
    return `/settings/integrations/${connection.id}/runs${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        label={ts("nav.breadcrumb")}
        items={[
          { label: ts("tabs.integrations"), href: "/settings/integrations" },
          { label: connection.displayName, href: `/settings/integrations/${connection.id}` },
          { label: t("runs.crumb") },
        ]}
      />
      <Panel title={t("runs.title")} description={t("runs.description")} flush>
        {history.total === 0 ? (
          <EmptyState title={t("runs.emptyTitle")} description={t("runs.emptyDescription")} />
        ) : (
          <>
            <Table caption={t("runs.tableCaption")}>
              <thead>
                <tr>
                  <Th>{t("runs.col.queued")}</Th>
                  <Th>{t("runs.col.trigger")}</Th>
                  <Th>{t("runs.col.status")}</Th>
                  <Th>{t("runs.col.finished")}</Th>
                  <Th numeric>{t("runs.col.created")}</Th>
                  <Th numeric>{t("runs.col.updated")}</Th>
                  <Th numeric>{t("runs.col.linked")}</Th>
                  <Th numeric>{t("runs.col.skipped")}</Th>
                  <Th>{t("runs.col.codes")}</Th>
                  <Th numeric>{t("runs.col.http")}</Th>
                  <Th>{t("runs.col.issues")}</Th>
                </tr>
              </thead>
              <tbody>
                {history.runs.map((run) => (
                  <Tr
                    key={run.id}
                    selected={detail !== null && selectedRun.success && selectedRun.data === run.id}
                  >
                    <Td className="tabular-nums">{f.dateTime(run.queuedAt)}</Td>
                    <Td>
                      {run.trigger === "manual" ? t("runs.trigger.manual") : t("runs.trigger.scheduled")}
                    </Td>
                    <Td>
                      <Badge tone={SYNC_RUN_STATUS_TONE[run.status]}>
                        {t(SYNC_RUN_STATUS_LABEL_KEYS[run.status])}
                      </Badge>
                    </Td>
                    <Td className="tabular-nums">
                      {run.finishedAt ? f.dateTime(run.finishedAt) : t("runs.notFinished")}
                    </Td>
                    <Td numeric>{f.number(run.createdCount)}</Td>
                    <Td numeric>{f.number(run.updatedCount)}</Td>
                    <Td numeric>{f.number(run.linkedCount)}</Td>
                    <Td numeric>{f.number(run.skippedCount)}</Td>
                    <Td>
                      {run.issueCodes.length === 0 ? (
                        <span className="text-muted">{t("runs.noCodes")}</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {runCodeLabelKeys(run.issueCodes).map((key) => (
                            <Badge key={key} dot={false}>
                              {t(key)}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </Td>
                    <Td numeric>{run.httpStatus === null ? "—" : run.httpStatus}</Td>
                    <Td>
                      {run.issueCount === 0 ? (
                        <span className="text-muted">{t("runs.noIssues")}</span>
                      ) : (
                        <Link
                          href={hrefFor(history.page, run.id)}
                          className="font-medium text-link hover:underline"
                        >
                          {t("runs.viewIssues", { count: run.issueCount })}
                        </Link>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Pagination
              page={history.page}
              pageSize={SYNC_RUNS_PAGE_SIZE}
              total={history.total}
              hrefFor={(target) => hrefFor(target)}
            />
          </>
        )}
      </Panel>

      {selectedRun.success && (
        <Panel
          title={t("runs.issues.title")}
          description={detail ? t("runs.issues.description") : undefined}
          flush={detail !== null && detail.issues.length > 0}
        >
          {detail === null ? (
            <p className="text-body text-text">{t("runs.issues.notFound")}</p>
          ) : detail.issues.length === 0 ? (
            <p className="text-body text-text">{t("runs.issues.empty")}</p>
          ) : (
            <>
              <Table caption={t("runs.issues.caption")}>
                <thead>
                  <tr>
                    <Th>{t("runs.issues.code")}</Th>
                    <Th>{t("runs.issues.patient")}</Th>
                    <Th>{t("runs.issues.recorded")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {detail.issues.map((issue) => (
                    <Tr key={issue.id}>
                      <Td>{t(issueCodeLabelKey(issue.code))}</Td>
                      <Td>
                        {issue.patientId ? (
                          <Link
                            href={`/patients/${issue.patientId}`}
                            className="font-medium text-link hover:underline"
                          >
                            {t("runs.issues.openPatient")}
                          </Link>
                        ) : (
                          <span className="text-muted">{t("runs.issues.noPatient")}</span>
                        )}
                      </Td>
                      <Td className="tabular-nums">{f.dateTime(issue.createdAt)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              {detail.truncated && (
                <p className="border-t border-border px-4 py-2.5 text-label text-muted">
                  {t("runs.issues.truncated", { count: f.number(MAX_SYNC_ISSUES_SHOWN) })}
                </p>
              )}
            </>
          )}
        </Panel>
      )}
    </div>
  );
}
