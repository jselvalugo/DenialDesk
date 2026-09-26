"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { todayIn } from "@rules/calendar";
import { canEditPatients, canTagSensitivity, canWorkDenials } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { withTenant } from "@/db/tenant";
import {
  createPatient,
  PatientRecordError,
  revealPatientMemberIdFor,
  searchPatientsAudited,
  updatePatient,
  type PatientListRow,
} from "@/domain/patients/queries";
import { patientSchema, SENSITIVITY_TAGS } from "@/domain/patients/record";
import { syntheticDataOnly } from "@/lib/env";

export interface PatientFormState {
  error?: string;
  /** Field that failed, so the form can mark it. */
  field?: string;
}

const NOT_ALLOWED = "Your role can view patients but not change them.";

/** Reads the patient form. Every field is short, so each is bounded before parsing. */
function readForm(formData: FormData) {
  const text = (name: string) => String(formData.get(name) ?? "").slice(0, 200);
  return {
    mrn: text("mrn"),
    firstName: text("firstName"),
    lastName: text("lastName"),
    birthDate: text("birthDate"),
    sex: text("sex"),
    addressLine1: text("addressLine1"),
    city: text("city"),
    state: text("state"),
    postalCode: text("postalCode"),
    phone: text("phone"),
    primaryPayerId: text("primaryPayerId"),
    memberId: text("memberId"),
    sensitivityTags: formData
      .getAll("sensitivityTags")
      .slice(0, Object.keys(SENSITIVITY_TAGS).length)
      .map(String),
  };
}

/** Pre-production accepts synthetic patients only (R-15.1); the person entering one says so. */
function missingAttestation(formData: FormData): PatientFormState | null {
  if (!syntheticDataOnly() || formData.get("syntheticAttestation") === "on") return null;
  return {
    error: "Confirm this patient is synthetic. Real patient data is not allowed here.",
    field: "syntheticAttestation",
  };
}

function parse(formData: FormData) {
  const parsed = patientSchema({ today: todayIn(), syntheticOnly: syntheticDataOnly() }).safeParse(
    readForm(formData),
  );
  if (parsed.success) return { data: parsed.data };
  const issue = parsed.error.issues[0]!;
  return { state: { error: issue.message, field: String(issue.path[0] ?? "") } };
}

/** Unique MRN races that slip past the pre-check still come back as a form error. */
function isDuplicateMrn(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "23505";
}

export async function registerPatient(_: PatientFormState, formData: FormData): Promise<PatientFormState> {
  const auth = await requireAuth();
  if (!canEditPatients(auth.role)) return { error: NOT_ALLOWED };
  const unattested = missingAttestation(formData);
  if (unattested) return unattested;
  const parsed = parse(formData);
  if (!parsed.data) return parsed.state;

  let id: string;
  const register = () =>
    withTenant(auth, (tx) =>
      createPatient(
        tx,
        {
          tenantId: auth.tenantId,
          userId: auth.userId,
          canTag: canTagSensitivity(auth.role),
          syntheticOnly: syntheticDataOnly(),
        },
        parsed.data,
      ),
    );
  try {
    try {
      ({ id } = await register());
    } catch (error) {
      // Two registrations at once can draw the same generated MRN; the second retries once.
      if (parsed.data.mrn || !isDuplicateMrn(error)) throw error;
      ({ id } = await register());
    }
  } catch (error) {
    if (error instanceof PatientRecordError) return { error: error.message, field: error.field };
    if (isDuplicateMrn(error)) return { error: "Another patient already has this MRN.", field: "mrn" };
    throw error;
  }
  revalidatePath("/patients");
  redirect(`/patients/${id}`);
}

export async function savePatient(_: PatientFormState, formData: FormData): Promise<PatientFormState> {
  const auth = await requireAuth();
  if (!canEditPatients(auth.role)) return { error: NOT_ALLOWED };
  const ids = z.object({ patientId: z.uuid(), expectedUpdatedAt: z.iso.datetime() }).safeParse({
    patientId: formData.get("patientId"),
    expectedUpdatedAt: formData.get("expectedUpdatedAt"),
  });
  if (!ids.success) return { error: "Reload the page and try again." };
  const reason = String(formData.get("reason") ?? "")
    .slice(0, 600)
    .trim();
  if (reason.length < 5 || reason.length > 500) {
    return { error: "Say why the record is changing (5 to 500 characters).", field: "reason" };
  }
  const unattested = missingAttestation(formData);
  if (unattested) return unattested;
  const parsed = parse(formData);
  if (!parsed.data) return parsed.state;

  try {
    await withTenant(auth, (tx) =>
      updatePatient(
        tx,
        {
          tenantId: auth.tenantId,
          userId: auth.userId,
          canTag: canTagSensitivity(auth.role),
          syntheticOnly: syntheticDataOnly(),
        },
        ids.data.patientId,
        ids.data.expectedUpdatedAt,
        parsed.data,
        reason,
      ),
    );
  } catch (error) {
    if (error instanceof PatientRecordError) return { error: error.message, field: error.field };
    if (isDuplicateMrn(error)) return { error: "Another patient already has this MRN.", field: "mrn" };
    throw error;
  }
  revalidatePath(`/patients/${ids.data.patientId}`);
  redirect(`/patients/${ids.data.patientId}`);
}

export interface SearchState {
  results?: PatientListRow[];
  error?: string;
}

/** Name or MRN search as a POST, so the terms never reach a URL, log, or analytics (CLAUDE.md #4). */
export async function findPatients(_: SearchState, formData: FormData): Promise<SearchState> {
  const auth = await requireAuth();
  const term = String(formData.get("q") ?? "").slice(0, 100);
  if (term.trim().length < 2) return { error: "Enter at least 2 characters of a name or MRN." };
  const results = await withTenant(auth, (tx) => searchPatientsAudited(tx, auth, term));
  return { results };
}

/** Returns a patient's full member ID and records who looked and why (R-7.5.1). */
export async function revealPatientMemberId(
  patientId: string,
  reason: string,
): Promise<{ value?: string; error?: string }> {
  const auth = await requireAuth();
  // Minimum necessary (R-5.1.2): the same roles that may reveal it from a denial.
  if (!canWorkDenials(auth.role)) return { error: "Your role can't view full member IDs." };
  const parsed = z
    .object({ patientId: z.uuid(), reason: z.enum(["appeal", "eligibility", "payer_call", "other"]) })
    .safeParse({ patientId, reason });
  if (!parsed.success) return { error: "Choose a reason." };
  return withTenant(auth, (tx) =>
    revealPatientMemberIdFor(tx, auth, parsed.data.patientId, parsed.data.reason),
  );
}
