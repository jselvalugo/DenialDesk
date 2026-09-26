import type { Role } from "./session";

/** Minimum-necessary role design (R-5.1.2): compliance reviews; it doesn't work denials. */
export function canWorkDenials(role: Role): boolean {
  return role === "admin" || role === "manager" || role === "specialist";
}
