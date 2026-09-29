import { asc, eq, sql } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { canGenerateClaimFile } from "@/auth/permissions";
import type { Role } from "@/auth/session";
import { claimLines, claims, locations, patients, payers, practiceSettings, providers } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import {
  build837P,
  Edi837Error,
  MAX_CONTROL_NUMBER,
  SYNTHETIC_ENVELOPE,
  validate837P,
  type Claim837Input,
  type Issue837,
  type Line837,
} from "@/edi/x12/837p";
import { audit } from "@/lib/audit";
import { decryptField } from "@/lib/crypto/field";
import { decryptProviderTin } from "@/lib/crypto/provider-tin";
import { syntheticDataOnly } from "@/lib/env";
import { filingStatus, type ClaimStatus } from "./status";

// Generates one 837P from a claim (docs/specs/claims.md C3a). Nothing is sent and nothing on the claim is
// written; the only writes are the practice's control number and the audit event. The member ID and the
// provider's TIN are decrypted in memory here, are never logged, and reach no error, audit row, or refusal.

/** Only these claims can be generated: not yet accepted by the payer (an original, frequency code 1). */
export const GENERATABLE_STATUSES: readonly ClaimStatus[] = ["draft", "rejected"];

/** The `practice_settings` row holding the practice's last used interchange control number. */
export const CONTROL_NUMBER_KEY = "x12.control_number";

export type GenerateRefusal = "forbidden" | "not_found" | "invalid";

export type Generate837Result =
  | {
      ok: true;
      /** The whole file, for download. Holds the member ID and TIN. */
      text: string;
      /** The same file with the member ID and TIN masked, for the screen. */
      preview: string;
      filename: string;
      controlNumber: number;
      segmentCount: number;
      lineCount: number;
      pastFilingDeadline: boolean;
    }
  | { ok: false; reason: GenerateRefusal; issues: Issue837[] };

export interface Generate837Actor {
  tenantId: string;
  userId: string;
  role: Role;
}

/** A person's diagnosis pointer choice per line number (1-based positions in the claim's diagnoses). */
export type PointerChoice = Record<number, number[]>;

/**
 * Takes the next interchange control number for the practice: one atomic upsert, so two concurrent calls
 * cannot get the same number (the conflicting row is locked until the first transaction ends).
 * The row is tenant-isolated by RLS like every practice table.
 */
export async function nextControlNumber(tx: TenantTx, tenantId: string): Promise<number> {
  const [row] = await tx
    .insert(practiceSettings)
    .values({ tenantId, key: CONTROL_NUMBER_KEY, value: "1" })
    .onConflictDoUpdate({
      target: [practiceSettings.tenantId, practiceSettings.key],
      set: { value: sql`(${practiceSettings.value}::bigint + 1)::text`, updatedAt: sql`now()` },
    })
    .returning({ value: practiceSettings.value });
  return Number(row!.value);
}

async function loadClaim(tx: TenantTx, claimId: string) {
  const [row] = await tx
    .select({
      claim: claims,
      patient: {
        id: patients.id,
        firstName: patients.firstName,
        lastName: patients.lastName,
        birthDate: patients.birthDate,
        sex: patients.sex,
        addressLine1: patients.addressLine1,
        city: patients.city,
        state: patients.state,
        postalCode: patients.postalCode,
        memberIdEnc: patients.memberIdEnc,
        primaryPayerId: patients.primaryPayerId,
        source: patients.source,
        coverageStatus: patients.coverageStatus,
      },
      provider: providers,
      placeOfService: locations.placeOfService,
      payer: { name: payers.name, ediPayerId: payers.ediPayerId, regime: payers.regime },
    })
    .from(claims)
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(providers, eq(providers.id, claims.providerId))
    .innerJoin(locations, eq(locations.id, claims.locationId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .where(eq(claims.id, claimId));
  if (!row) return null;
  const lines = await tx
    .select()
    .from(claimLines)
    .where(eq(claimLines.claimId, claimId))
    .orderBy(asc(claimLines.lineNumber));
  return { ...row, lines };
}

/**
 * Loads, validates, and (when nothing is missing) builds the 837P for one claim, in the caller's tenant
 * transaction. A refusal lists every problem by code; a success takes one control number. Both are audited
 * with IDs, counts, and codes only, never segment contents.
 */
export async function generateClaim837P(
  tx: TenantTx,
  actor: Generate837Actor,
  claimId: string,
  options: { pointers?: PointerChoice; now?: Date; today?: string } = {},
): Promise<Generate837Result> {
  const now = options.now ?? new Date();
  const refuse = async (
    reason: GenerateRefusal,
    issues: Issue837[],
    extra: Record<string, string | number | boolean | null> = {},
  ): Promise<Generate837Result> => {
    await audit(tx, {
      action: "claim.837p_refused",
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      entityType: "claim",
      entityId: claimId,
      reason: "edi_generation",
      metadata: {
        refusal: reason,
        issueCodes: [...new Set(issues.map((i) => i.code))].join(","),
        issueCount: issues.length,
        ...extra,
      },
    });
    return { ok: false, reason, issues };
  };

  if (!canGenerateClaimFile(actor.role)) return refuse("forbidden", []);
  // A real (P) file can't be made yet: the submitter and receiver identifiers are synthetic constants.
  if (!syntheticDataOnly()) return refuse("invalid", [{ code: "not_synthetic_environment" }]);

  const loaded = await loadClaim(tx, claimId);
  if (!loaded) return refuse("not_found", []);
  const { claim, patient, provider, payer } = loaded;

  const issues: Issue837[] = [];
  if (!GENERATABLE_STATUSES.includes(claim.status)) issues.push({ code: "status_not_generatable" });

  // Coverage: the member ID belongs to the patient's primary payer, and a synced patient's is only
  // trustworthy once its coverage is mapped (docs/specs/claims.md C1 note, patient-integrations PI1a).
  let memberId: string | null = null;
  const covered =
    patient.memberIdEnc !== null && (patient.source !== "fhir" || patient.coverageStatus === "mapped");
  if (!covered) issues.push({ code: "no_member_id" });
  const payerMismatch = patient.primaryPayerId !== claim.payerId;
  if (payerMismatch) issues.push({ code: "coverage_payer_mismatch" });
  const phiRead: string[] = [];
  // Another payer's member ID is never read, let alone sent.
  if (covered && !payerMismatch) {
    memberId = decryptField(patient.memberIdEnc!);
    phiRead.push("member_id");
  }
  let tin: string | null = null;
  if (provider.tinEnc !== null) {
    tin = decryptProviderTin(provider.tinEnc, actor.tenantId, provider.id);
    phiRead.push("tin");
  }
  const phiReadField = phiRead.join(",");

  // Diagnosis pointers are a person's choice; they are derived only where no choice exists (one diagnosis).
  const diagnosisCount = claim.diagnosisCodes.length;
  let userSelected = false;
  const lines: Line837[] = loaded.lines.map((l) => {
    const chosen = options.pointers?.[l.lineNumber];
    if (chosen) userSelected = true;
    return {
      lineNumber: l.lineNumber,
      procedureCode: l.procedureCode,
      modifiers: l.modifiers,
      units: l.units,
      chargeCents: l.chargeCents,
      diagnosisPointers: chosen ?? (diagnosisCount === 1 ? [1] : null),
    };
  });

  const input: Claim837Input = {
    envelope: SYNTHETIC_ENVELOPE,
    usage: "T",
    controlNumber: 1,
    createdAt: now,
    billingProvider: {
      npi: provider.npi,
      lastName: provider.lastName,
      firstName: provider.firstName,
      taxonomy: provider.taxonomy,
      tinType: provider.tinType === "EI" || provider.tinType === "SY" ? provider.tinType : null,
      tin,
      addressLine1: provider.addressLine1,
      city: provider.city,
      state: provider.state,
      postalCode: provider.postalCode,
    },
    subscriber: {
      memberId: memberId === "" ? null : memberId,
      lastName: patient.lastName,
      firstName: patient.firstName,
      birthDate: patient.birthDate,
      sex: patient.sex,
      addressLine1: patient.addressLine1,
      city: patient.city,
      state: patient.state,
      postalCode: patient.postalCode,
    },
    payer,
    claim: {
      claimNumber: claim.claimNumber,
      serviceDate: claim.serviceDate,
      diagnosisCodes: claim.diagnosisCodes,
      totalCents: claim.billedCents,
      placeOfService: loaded.placeOfService,
      lines,
    },
  };
  // A member ID left unread because the payer is wrong is not "missing": report the mismatch only.
  for (const issue of validate837P(input)) {
    if (issue.code === "no_member_id" && covered && payerMismatch) continue;
    if (!issues.some((i) => i.code === issue.code && i.line === issue.line && i.field === issue.field))
      issues.push(issue);
  }
  if (issues.length > 0) return refuse("invalid", issues, { phiRead: phiReadField });

  // Everything needed is present: take the practice's next number and build. From here the number is spent.
  const controlNumber = await nextControlNumber(tx, actor.tenantId);
  if (controlNumber > MAX_CONTROL_NUMBER) {
    return refuse("invalid", [{ code: "control_number_exhausted" }], { phiRead: phiReadField });
  }
  const final: Claim837Input = { ...input, controlNumber };
  let built;
  let masked;
  try {
    built = build837P(final);
    masked = build837P(final, { mask: true });
  } catch (error) {
    if (error instanceof Edi837Error) return refuse("invalid", error.issues, { phiRead: phiReadField });
    throw error;
  }

  await audit(tx, {
    action: "claim.837p_generated",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "claim",
    entityId: claimId,
    reason: "edi_generation",
    metadata: {
      patientId: patient.id,
      claimVersion: claim.version,
      controlNumber,
      segmentCount: built.segmentCount,
      lineCount: lines.length,
      usage: "T",
      pointerSource: userSelected ? "user_selected" : "single_diagnosis",
      phiRead: phiReadField,
    },
  });
  return {
    ok: true,
    text: built.text,
    preview: masked.text.split("~").join("~\n"),
    filename: `837p-${String(controlNumber).padStart(9, "0")}.x12`,
    controlNumber,
    segmentCount: built.segmentCount,
    lineCount: lines.length,
    pastFilingDeadline:
      payer.regime !== null &&
      filingStatus(payer.regime, claim.serviceDate, options.today ?? todayIn()).state === "past_deadline",
  };
}
