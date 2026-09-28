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
  function sortHeader(key: PatientSortKey, label: string) {
    const active = sort === key;
    const currentDir = active ? dir : PATIENT_SORT_DEFAULT_DIR[key];
    const nextDir = nextSortDir(active, currentDir, PATIENT_SORT_DEFAULT_DIR[key]);
    return {
      active,
      dir: currentDir,
      href: patientListHref(key, nextDir, 1),
      accessibleLabel: tc("sortable.ariaLabel", {
        column: label,
        direction: tc(nextDir === "asc" ? "sortable.ascending" : "sortable.descending"),
      }),
    };
  }

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
  const canEdit = canEditPatients(auth.role);
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

      <Panel flush>
        <PatientSearch summary={t("list.count", { count: total })} today={today} />
        {rows.length === 0 ? (
          <EmptyState
            title={t("list.emptyTitle")}
            description={canEdit ? t("list.emptyDescriptionCanEdit") : t("list.emptyDescriptionReadOnly")}
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
              name: sortHeader("name", tc("word.patient")),
              mrn: sortHeader("mrn", t("field.mrn")),
              birthDate: sortHeader("birthDate", t("field.birthDate")),
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
