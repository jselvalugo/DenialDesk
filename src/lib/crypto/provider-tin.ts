import { decryptField, encryptField } from "./field";

// A provider's tax ID (TIN) is field-level encrypted (R-7.3.3; a sole proprietor's TIN can be an SSN).
// The additional authenticated data binds the ciphertext to its practice, column, and provider, so a
// value copied to another row or practice fails to decrypt (ADR 0007). Only the 837P builder and the billing settings
// (docs/specs/claims.md C3a-S: the last four digits, and a comparison when a TIN is typed) decrypt it, in memory,
// and never log it.

function aad(tenantId: string, providerId: string): string {
  return `${tenantId}|providers.tin_enc|${providerId}`;
}

/** `key` is for tests; callers use the configured field-encryption key. */
export function encryptProviderTin(tin: string, tenantId: string, providerId: string, key?: Buffer): string {
  return encryptField(tin, key, aad(tenantId, providerId));
}

export function decryptProviderTin(
  payload: string,
  tenantId: string,
  providerId: string,
  key?: Buffer,
): string {
  return decryptField(payload, key, aad(tenantId, providerId));
}
