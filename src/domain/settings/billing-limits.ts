/**
 * Longest values the 837P generator accepts (NM103 60, NM104 35, N301 55, N401 30). Client-safe (no server
 * imports) so the form can cap its inputs; the server checks them again (docs/specs/claims.md C3a-S).
 */
export const BILLING_LIMITS = { firstName: 35, lastName: 60, addressLine1: 55, city: 30 } as const;
