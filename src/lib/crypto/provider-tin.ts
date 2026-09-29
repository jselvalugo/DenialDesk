import { decryptField, encryptField } from "./field";

// A provider's tax ID (TIN) is field-level encrypted (R-7.3.3; a sole proprietor's TIN can be an SSN).
// The additional authenticated data binds the ciphertext to its practice, column, and provider, so a
// value copied to another row or practice fails to decrypt (ADR 0007). Only the 837P builder decrypts it,
// in memory, and never logs it.

function aad(tenantId: string, providerId: string): string {
  return `${tenantId}|providers.tin_enc|${providerId}`;
}

export function encryptProviderTin(tin: string, tenantId: string, providerId: string): string {
  return encryptField(tin, undefined, aad(tenantId, providerId));
}

export function decryptProviderTin(payload: string, tenantId: string, providerId: string): string {
  return decryptField(payload, undefined, aad(tenantId, providerId));
}
