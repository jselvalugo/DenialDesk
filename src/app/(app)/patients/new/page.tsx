import type { Metadata } from "next";
import Link from "next/link";
import { todayIn } from "@rules/calendar";
import { canEditPatients } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { payerOptions } from "@/domain/denials/queries";
import { syntheticDataOnly } from "@/lib/env";
import { PatientForm } from "../PatientForm";

export const metadata: Metadata = { title: "Register patient" };

export default async function NewPatientPage() {
  const auth = await requireAuth();
  if (!canEditPatients(auth.role)) {
    return (
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
        <PageHeader title="Register patient" />
        <p role="note" className="text-body text-muted">
          Your role can view patients but not register them.{" "}
          <Link href="/patients" className="font-medium text-link hover:underline">
            Back to patients
          </Link>
        </p>
      </div>
    );
  }
  const payers = await withTenant(auth, (tx) => payerOptions(tx));

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-label text-muted">
        <Link href="/patients" className="font-medium text-link hover:underline">
          Patients
        </Link>{" "}
        <span aria-hidden>/</span> Register
      </nav>
      <PageHeader
        title="Register patient"
        description="Demographics and primary insurance. Claims for this patient will link to this record."
      />
      <Panel>
        <PatientForm payers={payers} syntheticOnly={syntheticDataOnly()} today={todayIn()} />
      </Panel>
    </div>
  );
}
