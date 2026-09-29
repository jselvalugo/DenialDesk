import { and, desc, eq } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import {
  appealLetterAttestations,
  appealLetterTemplates,
  appealLetterVersions,
  appeals,
  claims,
  denials,
  locations,
  patients,
  payers,
  providers,
  tenants,
  users,
} from "@/db/schema";
import { CARC, CATEGORY_ORDER, CATEGORY_LABEL_KEYS, type DenialCategory } from "@/domain/carc";
import { en } from "@/i18n/messages/en";
import { formatCents, formatDate } from "@/lib/format";
import type { MergeValues } from "./merge-fields";
import { starterTemplate } from "./starter-templates";

/** How many history rows the letter page lists. */
export const LETTER_HISTORY_LIMIT = 50;

const orNull = (value: string | null | undefined) => (value && value.length > 0 ? value : null);
const usDate = (iso: string | null) => (iso ? formatDate(iso, "en") : null);

/**
 * Loads the merge values for one appeal. Reads only the columns a field needs (HC-3.1); the member
 * ID is masked to its last four (the encrypted value is never selected). `letterDate` is the day the
 * letter version was saved, so a reprint does not change it.
 */
export async function loadMergeValues(
  tx: TenantTx,
  appealId: string,
  letterDate: string,
): Promise<{ values: MergeValues; category: DenialCategory; sensitive: boolean } | null> {
  const [row] = await tx
    .select({
      firstName: patients.firstName,
      lastName: patients.lastName,
      birthDate: patients.birthDate,
      memberIdLast4: patients.memberIdLast4,
      sensitivityTags: patients.sensitivityTags,
      sourceRestricted: patients.sourceRestricted,
      sourceSensitivity: patients.sourceSensitivity,
      claimNumber: claims.claimNumber,
      serviceDate: claims.serviceDate,
      billedCents: claims.billedCents,
      carc: denials.carc,
      rarcs: denials.rarcs,
      category: denials.category,
      deniedCents: denials.deniedCents,
      noticeDate: denials.noticeDate,
      payerName: payers.name,
      providerName: providers.name,
      providerNpi: providers.npi,
      practiceName: tenants.name,
      practiceCity: locations.city,
      deadline: appeals.deadline,
    })
    .from(appeals)
    .innerJoin(denials, eq(denials.id, appeals.denialId))
    .innerJoin(claims, eq(claims.id, appeals.claimId))
    .innerJoin(payers, eq(payers.id, claims.payerId))
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(providers, eq(providers.id, claims.providerId))
    .innerJoin(locations, eq(locations.id, claims.locationId))
    .innerJoin(tenants, eq(tenants.id, appeals.tenantId))
    .where(eq(appeals.id, appealId))
    .limit(1);
  if (!row) return null;
  const last4 = orNull(row.memberIdLast4);
  const values: MergeValues = {
    "patient.fullName": orNull(`${row.firstName} ${row.lastName}`.trim()),
    "patient.birthDate": usDate(row.birthDate),
    "patient.memberIdMasked": last4 ? `****${last4}` : null,
    "claim.number": orNull(row.claimNumber),
    "claim.serviceDate": usDate(row.serviceDate),
    "claim.billedAmount": formatCents(row.billedCents),
    "denial.carc": orNull(row.carc),
    "denial.carcDescription": CARC[row.carc]?.summary ?? null,
    "denial.rarcs": row.rarcs.length > 0 ? row.rarcs.join(", ") : "none",
    "denial.category": en.common[CATEGORY_LABEL_KEYS[row.category]],
    "denial.amount": formatCents(row.deniedCents),
    "denial.noticeDate": usDate(row.noticeDate),
    "payer.name": orNull(row.payerName),
    "provider.name": orNull(row.providerName),
    "provider.npi": orNull(row.providerNpi),
    "practice.name": orNull(row.practiceName),
    "practice.city": orNull(row.practiceCity),
    "appeal.deadline": usDate(row.deadline),
    "letter.date": usDate(letterDate),
  };
  // Fail closed until sensitivity handling exists (OA-031, OA-091): a patient with any sensitivity tag, or
  // marked restricted at the source, never gets a letter attested or exported.
  const sensitive =
    row.sensitivityTags.length > 0 || row.sourceRestricted || row.sourceSensitivity.length > 0;
  return { values, category: row.category, sensitive };
}

/** The wording a category starts from: the practice's own template, else the starter. */
export async function getTemplateBody(
  tx: TenantTx,
  category: DenialCategory,
): Promise<{ body: string; source: "practice" | "starter" }> {
  const [row] = await tx
    .select({ body: appealLetterTemplates.body })
    .from(appealLetterTemplates)
    .where(and(eq(appealLetterTemplates.category, category), eq(appealLetterTemplates.language, "en")))
    .limit(1);
  return row
    ? { body: row.body, source: "practice" }
    : { body: starterTemplate(category), source: "starter" };
}

/** One row per denial category: whether the practice has its own template yet. */
export async function listTemplateStatus(tx: TenantTx) {
  const rows = await tx
    .select({
      id: appealLetterTemplates.id,
      category: appealLetterTemplates.category,
      updatedAt: appealLetterTemplates.updatedAt,
      updatedBy: users.displayName,
    })
    .from(appealLetterTemplates)
    .innerJoin(users, eq(users.id, appealLetterTemplates.updatedBy))
    .where(eq(appealLetterTemplates.language, "en"));
  const byCategory = new Map(rows.map((row) => [row.category, row]));
  return CATEGORY_ORDER.map((category) => {
    const row = byCategory.get(category);
    return {
      category,
      source: row ? ("practice" as const) : ("starter" as const),
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  });
}

/** The latest letter version, its attestation, and the history list, for the letter page. */
export async function getLetterState(tx: TenantTx, appealId: string) {
  const history = await tx
    .select({
      version: appealLetterVersions.version,
      createdAt: appealLetterVersions.createdAt,
      author: users.displayName,
    })
    .from(appealLetterVersions)
    .innerJoin(users, eq(users.id, appealLetterVersions.createdBy))
    .where(eq(appealLetterVersions.appealId, appealId))
    .orderBy(desc(appealLetterVersions.version))
    .limit(LETTER_HISTORY_LIMIT);
  const latestMeta = history[0];
  if (!latestMeta) return { latest: null, history, attestation: null };

  const [latest] = await tx
    .select({
      version: appealLetterVersions.version,
      body: appealLetterVersions.body,
      createdAt: appealLetterVersions.createdAt,
    })
    .from(appealLetterVersions)
    .where(
      and(eq(appealLetterVersions.appealId, appealId), eq(appealLetterVersions.version, latestMeta.version)),
    );
  const [attestation] = await tx
    .select({
      renderedSha256: appealLetterAttestations.renderedSha256,
      attestedAt: appealLetterAttestations.attestedAt,
      attestedBy: users.displayName,
    })
    .from(appealLetterAttestations)
    .innerJoin(users, eq(users.id, appealLetterAttestations.attestedBy))
    .where(
      and(
        eq(appealLetterAttestations.appealId, appealId),
        eq(appealLetterAttestations.version, latestMeta.version),
      ),
    )
    .orderBy(desc(appealLetterAttestations.attestedAt))
    .limit(1);
  return { latest: latest ?? null, history, attestation: attestation ?? null };
}

/** Version number and review state only, for the appeal detail page's Letter panel. */
export async function getLetterSummary(tx: TenantTx, appealId: string) {
  const [latest] = await tx
    .select({ version: appealLetterVersions.version })
    .from(appealLetterVersions)
    .where(eq(appealLetterVersions.appealId, appealId))
    .orderBy(desc(appealLetterVersions.version))
    .limit(1);
  if (!latest) return { version: null, attested: false };
  const [attestation] = await tx
    .select({ id: appealLetterAttestations.id })
    .from(appealLetterAttestations)
    .where(
      and(
        eq(appealLetterAttestations.appealId, appealId),
        eq(appealLetterAttestations.version, latest.version),
      ),
    )
    .limit(1);
  return { version: latest.version, attested: Boolean(attestation) };
}

/** What the letter page needs about the appeal itself: whether it is still editable and its denial category. */
export async function getLetterTarget(tx: TenantTx, appealId: string) {
  const [row] = await tx
    .select({
      status: appeals.status,
      category: denials.category,
      claimNumber: claims.claimNumber,
    })
    .from(appeals)
    .innerJoin(denials, eq(denials.id, appeals.denialId))
    .innerJoin(claims, eq(claims.id, appeals.claimId))
    .where(eq(appeals.id, appealId))
    .limit(1);
  return row ?? null;
}
