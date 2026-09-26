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
