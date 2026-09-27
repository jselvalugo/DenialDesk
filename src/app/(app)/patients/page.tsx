import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canEditPatients } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { loadListValues } from "@/domain/custom-fields/list-values";
import { listPatients, PATIENTS_PAGE_SIZE } from "@/domain/patients/queries";
import { getT } from "@/i18n/server";
import { audit } from "@/lib/audit";
import { PatientSearch } from "./PatientSearch";
import { PatientTable } from "./PatientTable";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("patients");
  return { title: t("list.title") };
}

const newPatientClass =
  "inline-flex h-8 items-center rounded-control border border-primary bg-primary px-3 text-body font-medium text-white hover:border-primary-hover hover:bg-primary-hover";

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  const t = await getT("patients");
  // Only the page number is ever in the URL; searches are POSTed (no PHI in URLs).
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .catch(1)
    .parse((await searchParams).page);

  const { rows, total, listColumns, listValues } = await withTenant(auth, async (tx) => {
    const list = await listPatients(tx, page);
    await audit(tx, {
      action: "patient.list_viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      metadata: { patientIds: list.rows.map((r) => r.id).join(","), count: list.rows.length, page },
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
  if (total > 0 && page > pages) redirect(`/patients?page=${pages}`);
  const canEdit = canEditPatients(auth.role);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader
        title={t("list.title")}
        description={t("list.description")}
        actions={
          canEdit && (
            <Link href="/patients/new" className={newPatientClass}>
              {t("list.register")}
            </Link>
          )
        }
      />

      <Panel flush>
        <PatientSearch />
        {rows.length === 0 ? (
          <EmptyState
            title={t("list.emptyTitle")}
            description={canEdit ? t("list.emptyDescriptionCanEdit") : t("list.emptyDescriptionReadOnly")}
          />
        ) : (
          <PatientTable
            rows={rows}
            caption={t("list.title")}
            listColumns={listColumns}
            listValues={Object.fromEntries(
              [...listValues.entries()].map(([recordId, values]) => [recordId, Object.fromEntries(values)]),
            )}
          />
        )}
        <Pagination
          page={page}
          pageSize={PATIENTS_PAGE_SIZE}
          total={total}
          hrefFor={(p) => `/patients?page=${p}`}
        />
      </Panel>
    </div>
  );
}
