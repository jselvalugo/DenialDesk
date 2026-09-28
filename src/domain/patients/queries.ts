import { and, asc, count, desc, eq, ilike, inArray, like, ne, or, sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { claims, denials, integrationConnections, patients, payers } from "@/db/schema";
import { decryptField, encryptField } from "@/lib/crypto/field";
import { audit } from "@/lib/audit";
import { en } from "@/i18n/messages/en";
import type { Messages } from "@/i18n/messages/types";
import { createTranslator, type Translator } from "@/i18n/translate";
import { OPEN_STATUSES } from "@/domain/denial-status";
import { SYNTHETIC_MARKER } from "@/domain/synthetic/generator";
import {
  changedPatientFields,
  nextMrn,
  SENSITIVITY_TAG_LABEL_KEYS,
  type PatientInput,
  type SensitivityTag,
} from "./record";

type PatientsT = Translator<Messages["patients"]>;
/** English translator used when a caller doesn't have the request's language (e.g. integration tests). */
const englishPatientsT: PatientsT = createTranslator(en.patients, "en");

export const PATIENTS_PAGE_SIZE = 25;
export const SEARCH_LIMIT = 25;
/** Which fields a list or search row shows, recorded on `patient.list_viewed` / `patient.searched`. */
export const PATIENT_LIST_FIELDS = "name,mrn,birthDate,age,sex,location,coverage";

const listColumns = {
  id: patients.id,
  mrn: patients.mrn,
  firstName: patients.firstName,
  lastName: patients.lastName,
  birthDate: patients.birthDate,
  sex: patients.sex,
  city: patients.city,
  state: patients.state,
  payerName: payers.name,
  sensitivityTags: patients.sensitivityTags,
  sourceRestricted: patients.sourceRestricted,
};

export type PatientListRow = Awaited<ReturnType<typeof listPatients>>["rows"][number];

function listQuery(tx: TenantTx) {
  return tx.select(listColumns).from(patients).leftJoin(payers, eq(payers.id, patients.primaryPayerId));
}

/** One page of patients, alphabetical by last then first name. */
export async function listPatients(tx: TenantTx, page: number) {
  const rows = await listQuery(tx)
    .orderBy(asc(patients.lastName), asc(patients.firstName), asc(patients.mrn))
    .limit(PATIENTS_PAGE_SIZE)
    .offset((page - 1) * PATIENTS_PAGE_SIZE);
  const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(patients);
  return { rows, total };
}

/** Escapes LIKE wildcards so a search for "%" or "_" matches those characters literally. */
function literal(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Name or MRN search. "Last, First" searches both parts; a single word matches the start of the
 * first name, last name, or MRN. Callers keep the term out of URLs and logs.
 */
export async function searchPatients(tx: TenantTx, term: string) {
  const cleaned = term.trim().replace(/\s+/g, " ");
  if (cleaned.length < 2) return [];
  if (cleaned.includes(",")) {
    // "Last, First"; a blank first part ("Smith,") searches the last name only.
    const [last = "", first = ""] = cleaned.split(",").map((part) => part.trim());
    if (!last) return [];
    return listQuery(tx)
      .where(
        and(
          ilike(patients.lastName, `${literal(last)}%`),
          first ? ilike(patients.firstName, `${literal(first)}%`) : undefined,
        ),
      )
      .orderBy(asc(patients.lastName), asc(patients.firstName), asc(patients.mrn))
      .limit(SEARCH_LIMIT);
  }
  const where = or(
    ilike(patients.lastName, `${literal(cleaned)}%`),
    ilike(patients.firstName, `${literal(cleaned)}%`),
    ilike(patients.mrn, `${literal(cleaned)}%`),
    // "First Last"
    cleaned.includes(" ")
      ? sql`(${patients.firstName} || ' ' || ${patients.lastName}) ilike ${`${literal(cleaned)}%`}`
      : undefined,
  );
  return listQuery(tx)
    .where(where)
    .orderBy(asc(patients.lastName), asc(patients.firstName), asc(patients.mrn))
    .limit(SEARCH_LIMIT);
}

/** The patient chart: demographics, coverage, and every claim and denial that hangs off the patient. */
export async function getPatientChart(tx: TenantTx, patientId: string) {
  const [row] = await tx
    .select({
      patient: {
        id: patients.id,
        mrn: patients.mrn,
        firstName: patients.firstName,
        lastName: patients.lastName,
        birthDate: patients.birthDate,
        sex: patients.sex,
        addressLine1: patients.addressLine1,
        city: patients.city,
        state: patients.state,
        postalCode: patients.postalCode,
        phone: patients.phone,
        primaryPayerId: patients.primaryPayerId,
        memberIdLast4: patients.memberIdLast4,
        sensitivityTags: patients.sensitivityTags,
        sourceRestricted: patients.sourceRestricted,
        // Provenance (docs/specs/patient-integrations.md "PI1b"): drives the "Synced from…" line
        // and hides the Edit action on a synced patient's chart.
        source: patients.source,
        sourceConnectionId: patients.sourceConnectionId,
        syncedAt: patients.syncedAt,
        createdAt: patients.createdAt,
        updatedAt: patients.updatedAt,
      },
      payer: { id: payers.id, name: payers.name, regime: payers.regime },
    })
    .from(patients)
    .leftJoin(payers, eq(payers.id, patients.primaryPayerId))
    .where(eq(patients.id, patientId))
    .limit(1);
  if (!row) return null;

  // Sequential: one transaction runs one query at a time.
  const patientClaims = await tx
    .select({
      id: claims.id,
      claimNumber: claims.claimNumber,
      serviceDate: claims.serviceDate,
      billedCents: claims.billedCents,
      paidCents: claims.paidCents,
      status: claims.status,
      payerName: payers.name,
    })
    .from(claims)
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .where(eq(claims.patientId, patientId))
    .orderBy(desc(claims.serviceDate), asc(claims.claimNumber));
  const claimIds = patientClaims.map((c) => c.id);
  const patientDenials =
    claimIds.length === 0
      ? []
      : await tx
          .select({
            id: denials.id,
            claimId: denials.claimId,
            claimNumber: claims.claimNumber,
            groupCode: denials.groupCode,
            carc: denials.carc,
            category: denials.category,
            deniedCents: denials.deniedCents,
            status: denials.status,
            noticeDate: denials.noticeDate,
            appealDeadline: denials.appealDeadline,
          })
          .from(denials)
          .innerJoin(claims, eq(claims.id, denials.claimId))
          .where(inArray(denials.claimId, claimIds))
          .orderBy(desc(denials.noticeDate));

  const totals = {
    claims: patientClaims.length,
    billedCents: patientClaims.reduce((sum, c) => sum + c.billedCents, 0),
    paidCents: patientClaims.reduce((sum, c) => sum + c.paidCents, 0),
    openDenials: patientDenials.filter((d) => OPEN_STATUSES.includes(d.status)).length,
    openDeniedCents: patientDenials
      .filter((d) => OPEN_STATUSES.includes(d.status))
      .reduce((sum, d) => sum + d.deniedCents, 0),
  };
  return { ...row, claims: patientClaims, denials: patientDenials, totals };
}

export type PatientChart = NonNullable<Awaited<ReturnType<typeof getPatientChart>>>;

/** The editable fields of one patient, for the edit form. */
export async function getPatientForEdit(tx: TenantTx, patientId: string) {
  const [row] = await tx
    .select({
      id: patients.id,
      mrn: patients.mrn,
      firstName: patients.firstName,
      lastName: patients.lastName,
      birthDate: patients.birthDate,
      sex: patients.sex,
      addressLine1: patients.addressLine1,
      city: patients.city,
      state: patients.state,
      postalCode: patients.postalCode,
      phone: patients.phone,
      primaryPayerId: patients.primaryPayerId,
      // No member ID on a synced patient without a mapped coverage (nullable, PI1a): the form
      // treats that the same as self-pay ("").
      memberIdLast4: sql<string>`coalesce(${patients.memberIdLast4}, '')`,
      sensitivityTags: patients.sensitivityTags,
      updatedAt: patients.updatedAt,
    })
    .from(patients)
    .where(eq(patients.id, patientId))
    .limit(1);
  return row ?? null;
}

export class PatientRecordError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "PatientRecordError";
  }
}

/**
 * Registering or editing a patient by hand is refused while the practice's Patients table has an
 * EHR/PM connection outside draft/revoked (docs/specs/patient-integrations.md "PI1a"; ADR 0010):
 * once a connection is submitted, the EHR becomes the system of record.
 *
 * Correctness review N2 (final round): a naive `WHERE status NOT IN ('draft', 'revoked')` before
 * the `FOR SHARE` lock only locks rows that already look blocking — a connection still `draft` at
 * this statement's snapshot is never selected, so it's never locked, and a concurrent Submit can
 * still move it out of draft in between this check and the write that follows it. Every
 * non-`revoked` row for this table (draft included) is locked here instead, so a concurrent Submit
 * has to wait for this transaction; only then is the blocking status decided, in code.
 */
async function assertPatientsRegisterOpen(tx: TenantTx, t: PatientsT = englishPatientsT) {
  const candidates = await tx
    .select({ status: integrationConnections.status })
    .from(integrationConnections)
    .where(
      and(eq(integrationConnections.targetTable, "patients"), ne(integrationConnections.status, "revoked")),
    )
    .for("share");
  const blocking = candidates.some((row) => row.status !== "draft");
  if (blocking) throw new PatientRecordError(t("error.integrationConnected"));
}

/** FKs bypass RLS, so a payer ID from the form is checked against this practice first. */
async function assertPracticePayer(tx: TenantTx, payerId: string | null, t: PatientsT = englishPatientsT) {
  if (!payerId) return;
  const [payer] = await tx.select({ id: payers.id }).from(payers).where(eq(payers.id, payerId)).limit(1);
  if (!payer) throw new PatientRecordError(t("error.choosePayer"), "primaryPayerId");
}

async function assertMrnFree(tx: TenantTx, mrn: string, exceptId?: string, t: PatientsT = englishPatientsT) {
  const [taken] = await tx.select({ id: patients.id }).from(patients).where(eq(patients.mrn, mrn)).limit(1);
  if (taken && taken.id !== exceptId) {
    throw new PatientRecordError(t("error.duplicateMrn"), "mrn");
  }
}

async function generateMrn(tx: TenantTx, syntheticOnly: boolean): Promise<string> {
  const prefix = syntheticOnly ? `${SYNTHETIC_MARKER}-` : "MRN-";
  // Highest all-digit suffix; hand-entered MRNs like "SYN-A7" are ignored rather than sorted.
  const pattern = `^${prefix}([0-9]{1,15})$`;
  const [row] = await tx
    .select({ highest: sql<string | null>`max((substring(${patients.mrn} from ${pattern}))::bigint)` })
    .from(patients)
    .where(like(patients.mrn, `${prefix}%`));
  return nextMrn(row?.highest ? [`${prefix}${row.highest}`] : [], syntheticOnly);
}

interface Actor {
  tenantId: string;
  userId: string;
  /** Only administrators set sensitivity tags; others keep what is stored. */
  canTag: boolean;
  syntheticOnly: boolean;
}

/** Registers a patient and audits it (field names only). */
export async function createPatient(
  tx: TenantTx,
  actor: Actor,
  input: PatientInput,
  t: PatientsT = englishPatientsT,
): Promise<{ id: string }> {
  await assertPatientsRegisterOpen(tx, t);
  await assertPracticePayer(tx, input.primaryPayerId, t);
  if (input.primaryPayerId && !input.memberId) {
    throw new PatientRecordError(t("error.enterMemberIdForPayer"), "memberId");
  }
  const mrn = input.mrn ?? (await generateMrn(tx, actor.syntheticOnly));
  await assertMrnFree(tx, mrn, undefined, t);
  const [created] = await tx
    .insert(patients)
    .values({
      tenantId: actor.tenantId,
      mrn,
      firstName: input.firstName,
      lastName: input.lastName,
      birthDate: input.birthDate,
      sex: input.sex,
      addressLine1: input.addressLine1,
      city: input.city,
      state: input.state,
      postalCode: input.postalCode,
      phone: input.phone,
      primaryPayerId: input.primaryPayerId,
      // A manual row always keeps a member ID (patients_member_id_presence CHECK): no insurance on
      // file yet is an empty encrypted value, not a null one.
      memberIdEnc: encryptField(input.memberId ?? ""),
      memberIdLast4: input.memberId ? input.memberId.slice(-4) : "",
      sensitivityTags: actor.canTag ? input.sensitivityTags : [],
    })
    .returning({ id: patients.id });
  await audit(tx, {
    action: "patient.created",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "patient",
    entityId: created!.id,
    metadata: { mrnGenerated: !input.mrn, hasCoverage: Boolean(input.primaryPayerId) },
  });
  return { id: created!.id };
}

/**
 * Updates a patient. `expectedUpdatedAt` rejects edits made from a stale page. The reason is kept
 * in the audit trail with the names of the changed fields (never their values). Refused outright
 * on a synced patient (source = 'fhir'): the EHR/PM is the system of record and demographics are
 * read-only here (docs/specs/patient-integrations.md "PI1a"; the `patients_synced_readonly`
 * trigger enforces this too, as defense in depth). Sensitivity tags stay editable on a synced
 * patient (spec "PI1a") through the separate `updatePatientSensitivityTags`, not this function.
 * The synced-patient refusal is checked before the connection-open check (correctness review N8):
 * a synced patient's own connection is virtually always outside draft/revoked too, and the more
 * specific "this record is synced" message is the one worth showing.
 */
export async function updatePatient(
  tx: TenantTx,
  actor: Actor,
  patientId: string,
  expectedUpdatedAt: string,
  input: PatientInput,
  reason: string,
  t: PatientsT = englishPatientsT,
): Promise<{ changedFields: string[] }> {
  const [current] = await tx.select().from(patients).where(eq(patients.id, patientId)).for("update").limit(1);
  if (!current) throw new PatientRecordError(t("error.patientNotFound"));
  if (current.source === "fhir") throw new PatientRecordError(t("error.syncedReadOnly"));
  await assertPatientsRegisterOpen(tx, t);
  if (current.updatedAt.toISOString() !== expectedUpdatedAt) {
    throw new PatientRecordError(t("error.staleRecord"));
  }
  const next = {
    ...input,
    sensitivityTags: actor.canTag ? input.sensitivityTags : [...current.sensitivityTags].sort(),
  };
  const changed = changedPatientFields(current, next);
  if (changed.length === 0) return { changedFields: [] };
  const payerChanged = changed.includes("primaryPayerId");
  if (payerChanged) await assertPracticePayer(tx, next.primaryPayerId, t);
  if (changed.includes("mrn")) await assertMrnFree(tx, next.mrn!, patientId, t);
  // A member ID belongs to one payer: a new payer needs its own, never the old payer's.
  if (next.primaryPayerId && !next.memberId && (payerChanged || !current.memberIdLast4)) {
    throw new PatientRecordError(t("error.enterMemberIdForPayer"), "memberId");
  }
  // Self-pay keeps no member ID (minimum necessary).
  const clearMemberId = !next.primaryPayerId && Boolean(current.memberIdLast4);
  if (clearMemberId && !changed.includes("memberId")) changed.push("memberId");

  await tx
    .update(patients)
    .set({
      mrn: next.mrn ?? current.mrn,
      firstName: next.firstName,
      lastName: next.lastName,
      birthDate: next.birthDate,
      sex: next.sex,
      addressLine1: next.addressLine1,
      city: next.city,
      state: next.state,
      postalCode: next.postalCode,
      phone: next.phone,
      primaryPayerId: next.primaryPayerId,
      ...(next.memberId
        ? { memberIdEnc: encryptField(next.memberId), memberIdLast4: next.memberId.slice(-4) }
        : clearMemberId
          ? { memberIdEnc: encryptField(""), memberIdLast4: "" }
          : {}),
      sensitivityTags: next.sensitivityTags,
      updatedAt: sql`now()`,
    })
    .where(eq(patients.id, patientId));
  await audit(tx, {
    action: "patient.updated",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "patient",
    entityId: patientId,
    reason,
    metadata: { changedFields: changed.join(",") },
  });
  if (changed.includes("sensitivityTags")) {
    // Its own event: removing a tag lowers a record's protection. Tag keys are enum values, not PHI.
    const before = new Set(current.sensitivityTags);
    const after = new Set(next.sensitivityTags);
    await audit(tx, {
      action: "patient.sensitivity_changed",
      actorUserId: actor.userId,
      tenantId: actor.tenantId,
      entityType: "patient",
      entityId: patientId,
      reason,
      metadata: {
        added: [...after].filter((t) => !before.has(t)).join(","),
        removed: [...before].filter((t) => !after.has(t)).join(","),
      },
    });
  }
  return { changedFields: changed };
}

const VALID_SENSITIVITY_TAGS = new Set<string>(Object.keys(SENSITIVITY_TAG_LABEL_KEYS));

/**
 * Sets a patient's sensitivity tags alone (R-3.5.1). Unlike `updatePatient`, this stays available
 * on a synced patient (docs/specs/patient-integrations.md "PI1a": "Sensitivity tags... stay
 * editable on synced patients") — tags are practice-owned, not part of the EHR/PM copy. Refused for
 * a non-administrator (`actor.canTag`, same gate as `createPatient`/`updatePatient`) and for any
 * value that isn't a known tag (compliance review B2 / security M6): callers pass form input here,
 * not a value already validated by `patientSchema`.
 */
export async function updatePatientSensitivityTags(
  tx: TenantTx,
  actor: { tenantId: string; userId: string; canTag: boolean },
  patientId: string,
  tags: SensitivityTag[],
  reason: string,
  t: PatientsT = englishPatientsT,
): Promise<{ changed: boolean }> {
  if (!actor.canTag) throw new PatientRecordError(t("error.roleCannotTag"));
  if (tags.some((tag) => !VALID_SENSITIVITY_TAGS.has(tag))) {
    throw new PatientRecordError(t("error.invalidSensitivityTag"));
  }
  const [current] = await tx
    .select({ sensitivityTags: patients.sensitivityTags })
    .from(patients)
    .where(eq(patients.id, patientId))
    .for("update")
    .limit(1);
  if (!current) throw new PatientRecordError(t("error.patientNotFound"));
  const before: string[] = [...new Set(current.sensitivityTags)].sort();
  const after: string[] = [...new Set(tags)].sort();
  if (before.join(",") === after.join(",")) return { changed: false };
  await tx
    .update(patients)
    .set({ sensitivityTags: after, updatedAt: sql`now()` })
    .where(eq(patients.id, patientId));
  await audit(tx, {
    action: "patient.sensitivity_changed",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "patient",
    entityId: patientId,
    reason,
    metadata: {
      added: after.filter((tag) => !before.includes(tag)).join(","),
      removed: before.filter((tag) => !after.includes(tag)).join(","),
    },
  });
  return { changed: true };
}

/** Search plus its audit event: result IDs and count, never the terms (CLAUDE.md #4). */
export async function searchPatientsAudited(
  tx: TenantTx,
  actor: { tenantId: string; userId: string },
  term: string,
) {
  const results = await searchPatients(tx, term);
  await audit(tx, {
    action: "patient.searched",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    metadata: {
      patientIds: results.map((r) => r.id).join(","),
      count: results.length,
      fields: PATIENT_LIST_FIELDS,
    },
  });
  return results;
}

export type RevealReason = "appeal" | "eligibility" | "payer_call" | "other";

/** Decrypts a patient's member ID and records who looked and why (R-7.5.1). */
export async function revealPatientMemberIdFor(
  tx: TenantTx,
  actor: { tenantId: string; userId: string },
  patientId: string,
  reason: RevealReason,
  t: PatientsT = englishPatientsT,
): Promise<{ value?: string; error?: string }> {
  const [row] = await tx
    .select({ memberIdEnc: patients.memberIdEnc, memberIdLast4: patients.memberIdLast4 })
    .from(patients)
    .where(eq(patients.id, patientId))
    .limit(1);
  if (!row) return { error: t("error.notFound") };
  if (!row.memberIdLast4 || !row.memberIdEnc) return { error: t("error.noMemberIdOnFile") };
  await audit(tx, {
    action: "patient.member_id_revealed",
    actorUserId: actor.userId,
    tenantId: actor.tenantId,
    entityType: "patient",
    entityId: patientId,
    reason,
    metadata: { from: "patient_chart" },
  });
  return { value: decryptField(row.memberIdEnc) };
}
