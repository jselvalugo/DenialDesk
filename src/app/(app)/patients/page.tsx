import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { canEditPatients } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { listPatients, PATIENTS_PAGE_SIZE } from "@/domain/patients/queries";
import { audit } from "@/lib/audit";
import { PatientSearch } from "./PatientSearch";
import { PatientTable } from "./PatientTable";

export const metadata: Metadata = { title: "Patients" };

const newPatientClass =
  "inline-flex h-8 items-center rounded-control border border-primary bg-primary px-3 text-body font-medium text-white hover:border-primary-hover hover:bg-primary-hover";

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  // Only the page number is ever in the URL; searches are POSTed (no PHI in URLs).
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .catch(1)
    .parse((await searchParams).page);

  const { rows, total } = await withTenant(auth, async (tx) => {
    const list = await listPatients(tx, page);
    await audit(tx, {
      action: "patient.list_viewed",
      actorUserId: auth.userId,
      tenantId: auth.tenantId,
      metadata: { patientIds: list.rows.map((r) => r.id).join(","), count: list.rows.length, page },
    });
    return list;
  });

  const pages = Math.max(1, Math.ceil(total / PATIENTS_PAGE_SIZE));
  if (total > 0 && page > pages) redirect(`/patients?page=${pages}`);
  const first = total === 0 ? 0 : (page - 1) * PATIENTS_PAGE_SIZE + 1;
  const last = Math.min(page * PATIENTS_PAGE_SIZE, total);
  const canEdit = canEditPatients(auth.role);

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader
        title="Patients"
        description="Every claim and denial belongs to a patient. Open a patient to see their coverage, claims, and denials in one place."
        actions={
          canEdit && (
            <Link href="/patients/new" className={newPatientClass}>
              Register patient
            </Link>
          )
        }
      />

      <Panel flush>
        <PatientSearch />
        {rows.length === 0 ? (
          <EmptyState
            title="No patients yet"
            description={
              canEdit
                ? "Register a patient to start their record. Claims and denials link to it."
                : "Patients appear here once your team registers them."
            }
          />
        ) : (
          <PatientTable rows={rows} caption="Patients" />
        )}
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between border-t border-border px-4 py-2.5 text-label text-muted"
        >
          <span className="tabular">
            {total === 0 ? "No results" : `Showing ${first}–${last} of ${total.toLocaleString("en-US")}`}
          </span>
          <span className="flex items-center gap-2">
            <PageLink disabled={page <= 1} href={`/patients?page=${page - 1}`}>
              Previous
            </PageLink>
            <span className="tabular">
              Page {page} of {pages}
            </span>
            <PageLink disabled={page >= pages} href={`/patients?page=${page + 1}`}>
              Next
            </PageLink>
          </span>
        </nav>
      </Panel>
    </div>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const className = "inline-flex h-7 items-center rounded-control border px-2.5 font-medium";
  if (disabled) {
    return (
      <span aria-disabled="true" className={`${className} border-border text-subtle`}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className={`${className} border-border-strong bg-surface text-text hover:bg-surface-muted`}
    >
      {children}
    </Link>
  );
}
