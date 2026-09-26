import type { Role } from "./session";

/** Minimum-necessary role design (R-5.1.2): compliance reviews; it doesn't work denials. */
export function canWorkDenials(role: Role): boolean {
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
