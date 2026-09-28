import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { canEditPatients } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { nextSortDir } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { primaryLinkButtonClass } from "@/components/ui/linkButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { loadListValues } from "@/domain/custom-fields/list-values";
import { blocksPatientsRegister } from "@/domain/integrations/connections";
import { loadPatientsConnectionSummary } from "@/components/shell/connection-summary";
import {
  listPatients,
  PATIENT_LIST_FIELDS,
  PATIENT_SORT_DEFAULT_DIR,
  PATIENTS_PAGE_SIZE,
  type PatientSortKey,
} from "@/domain/patients/queries";
import { getT } from "@/i18n/server";
import { audit } from "@/lib/audit";
import { PatientSearch } from "./PatientSearch";
import { PatientTable } from "./PatientTable";
import { parsePatientSort, patientListHref } from "./sort";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("patients");
  return { title: t("list.title") };
}

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const t = await getT("patients");
  const params = await searchParams;
  // Only the page number and sort are ever in the URL; searches are POSTed (no PHI in URLs).
  const page = z.coerce.number().int().min(1).max(10_000).catch(1).parse(params.page);
  const { sort, dir } = parsePatientSort(params);
  const tc = await getT("common");
  /** Props for one sortable column header (P4, docs/specs/record-pages.md). */
  function sortHeader(key: PatientSortKey): {
    active: boolean;
    dir: "asc" | "desc";
    href: string;
    hint: string;
  } {
    const active = sort === key;
    const currentDir = active ? dir : PATIENT_SORT_DEFAULT_DIR[key];
    const nextDir = nextSortDir(active, currentDir, PATIENT_SORT_DEFAULT_DIR[key]);
    return {
      active,
      dir: currentDir,
      href: patientListHref(key, nextDir, 1),
      hint: tc("sortable.hint", {
        direction: tc(nextDir === "asc" ? "sortable.ascending" : "sortable.descending"),
      }),
    };
  }

  // Request-memoized (React `cache()`): the signed-in layout (`AppShell`) already loads this same
  // summary for the tab-bar drop-down, so this shares that one query rather than running it again
  // (security/correctness review PR #81, item 18).
  const connectionSummary = await loadPatientsConnectionSummary();

  const { rows, total, listColumns, listValues } = await withTenant(auth, async (tx) => {
    const list = await listPatients(tx, page, sort, dir);
    await audit(tx, {
      action: "patient.list_viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      metadata: {
        patientIds: list.rows.map((r) => r.id).join(","),
        count: list.rows.length,
        page,
        fields: PATIENT_LIST_FIELDS,
      },
    });
    const { columns, valuesByRecord } = await loadListValues(
      tx,
      auth,
      "patient",
      list.rows.map((r) => r.id),
    );
    return { ...list, listColumns: columns, listValues: valuesByRecord };
  });

  const pages = Math.max(1, Math.ceil(total / PATIENTS_PAGE_SIZE));
  if (total > 0 && page > pages) redirect(patientListHref(sort, dir, pages));
  // A connected EHR/PM makes the Patient Register read-only (docs/specs/patient-integrations.md
  // "PI1a"): the Register button and empty-state action are hidden and a notice explains why.
  const registerBlocked = blocksPatientsRegister(connectionSummary);
  const canEdit = canEditPatients(auth.role) && !registerBlocked;
  const today = todayIn();

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader
        title={t("list.title")}
        description={t("list.description")}
        actions={
          canEdit && (
            <Link href="/patients/new" className={primaryLinkButtonClass}>
              {t("list.register")}
            </Link>
          )
        }
      />

      {registerBlocked && connectionSummary && (
        <p
          role="note"
          className="rounded-control border border-info-border bg-info-bg px-3 py-2 text-label text-info-fg"
        >
          {connectionSummary.status === "active"
            ? t("notice.syncedFromConnection", { name: connectionSummary.displayName })
            : t("notice.connectionBeingSetUp", { name: connectionSummary.displayName })}
        </p>
      )}

      <Panel flush>
        <PatientSearch summary={t("list.count", { count: total })} today={today} />
        {rows.length === 0 ? (
          <EmptyState
            title={t("list.emptyTitle")}
            description={
              registerBlocked && connectionSummary
                ? connectionSummary.status === "active"
                  ? t("list.emptyDescriptionSynced", { name: connectionSummary.displayName })
                  : t("list.emptyDescriptionConnectionSettingUp", { name: connectionSummary.displayName })
                : canEdit
                  ? t("list.emptyDescriptionCanEdit")
                  : t("list.emptyDescriptionReadOnly")
            }
            action={
              canEdit && (
                <Link href="/patients/new" className={primaryLinkButtonClass}>
                  {t("list.register")}
                </Link>
              )
            }
          />
        ) : (
          <PatientTable
            rows={rows}
            caption={t("list.title")}
            today={today}
            listColumns={listColumns}
            listValues={Object.fromEntries(
              [...listValues.entries()].map(([recordId, values]) => [recordId, Object.fromEntries(values)]),
            )}
            sort={{
              name: sortHeader("name"),
              mrn: sortHeader("mrn"),
              birthDate: sortHeader("birthDate"),
            }}
          />
        )}
        <Pagination
          page={page}
          pageSize={PATIENTS_PAGE_SIZE}
          total={total}
          hrefFor={(p) => patientListHref(sort, dir, p)}
        />
      </Panel>
    </div>
  );
}
