import type { Role } from "./session";

/** Minimum-necessary role design (R-5.1.2): compliance reviews; it doesn't work denials. */
export function canWorkDenials(role: Role): boolean {
  return role === "admin" || role === "manager" || role === "specialist";
}

/** Appeals (R-5.1.2, same matrix as denial-queue.md and claims.md): compliance reviews only. */
export function canWorkAppeals(role: Role): boolean {
  return role === "admin" || role === "manager" || role === "specialist";
}

/** Revenue cycle accounting (practice finance): compliance may review, specialists don't need it. */
export function canViewRevenueCycle(role: Role): boolean {
  return role === "admin" || role === "manager" || role === "compliance";
}

/** Loading or changing accounting configuration (rules, GL accounts): administrators only. */
export function canConfigureRevenueCycle(role: Role): boolean {
  return role === "admin";
}

/** Month-end work: importing files (and, later, preparing journal vouchers). */
export function canRunRevenueCycle(role: Role): boolean {
  return role === "admin" || role === "manager";
}

/** Correcting draft or rejected claims: the people who bill (compliance reviews, R-5.1.2). */
export function canCorrectClaims(role: Role): boolean {
  return role === "admin" || role === "manager" || role === "specialist";
}

/**
 * Importing charges (CSV) into draft claims (docs/specs/claims.md C2): the people who bill, the same set
 * as `canCorrectClaims`. Compliance reviews only (R-5.1.2).
 */
export function canImportCharges(role: Role): boolean {
  return role === "admin" || role === "manager" || role === "specialist";
}

/** Registering and updating patient records: the people who bill (compliance reviews, R-5.1.2). */
export function canEditPatients(role: Role): boolean {
  return role === "admin" || role === "manager" || role === "specialist";
}

/** Sensitivity tags drive stricter access (R-3.5.1), so only administrators set them. */
export function canTagSensitivity(role: Role): boolean {
  return role === "admin";
}

/** Practice settings (custom fields and, later, users and security): administrators only. */
export function canConfigureSettings(role: Role): boolean {
  return role === "admin";
}

/**
 * A payer's own custom field values (docs/specs/settings-and-custom-fields.md S2 PR4): owner-
 * confirmable choice (spec, S2 PR4) — administrators and managers, not front-line specialists or
 * compliance, since payers are practice configuration rather than a record a biller corrects.
 */
export function canEditPayerFields(role: Role): boolean {
  return role === "admin" || role === "manager";
}

/** Insight standard reports: every role can view (owner decision 2026-09-26). */
export function canViewInsight(role: Role): boolean {
  return Boolean(role);
}

/**
 * Exporting an Insight report leaves the audited system as a file, so it is kept to the roles
 * above front-line specialist (owner decision 2026-09-26), matching the revenue-cycle pattern.
 */
export function canExportInsight(role: Role): boolean {
  return role === "admin" || role === "manager" || role === "compliance";
}

/** Loading and posting remittances (835): the people who bill (compliance reviews, R-5.1.2). */
export function canPostRemittances(role: Role): boolean {
  return role === "admin" || role === "manager" || role === "specialist";
}

/** Voiding a remittance loaded in error: administrators and managers. */
export function canVoidRemittances(role: Role): boolean {
  return role === "admin" || role === "manager";
}

/** Recording payer contests on a prompt-pay clock: the people who bill (R-5.1.2). */
export function canRecordPromptPay(role: Role): boolean {
  return role === "admin" || role === "manager" || role === "specialist";
}

/** University wiki: product documentation with no PHI, so every role can read it. */
export function canViewUniversity(role: Role): boolean {
  return Boolean(role);
}

/**
 * Connecting, testing, submitting, pausing, resuming, revoking, and payer-mapping an EHR/PM
 * integration (docs/specs/patient-integrations.md): administrators only, same as other practice
 * configuration (canConfigureSettings).
 */
export function canManageIntegrations(role: Role): boolean {
  return role === "admin";
}
