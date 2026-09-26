import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/env";

// AES-256-GCM field encryption for high-risk identifiers (R-7.3.3).
// Format: v1.<iv>.<tag>.<ciphertext>, each base64url. The version prefix allows key rotation.
const VERSION = "v1";
const AUTH_TAG_LENGTH = 16;

function key(): Buffer {
  return Buffer.from(serverEnv().FIELD_ENCRYPTION_KEY, "base64");
}

/**
 * `aad` (additional authenticated data, e.g. `tenant_id|field_id|record_id`, ADR 0007) binds the
 * ciphertext to where it was written, without being stored itself: GCM authenticates it, so
 * decrypting with a different `aad` (a value copied to another row, record, or tenant) fails. The
 * format stays `v1`; callers that pass no `aad` are unaffected.
 */
export function encryptField(plaintext: string, encryptionKey: Buffer = key(), aad?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv, { authTagLength: AUTH_TAG_LENGTH });
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptField(payload: string, encryptionKey: Buffer = key(), aad?: string): string {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error("Unrecognized encrypted field format");
  }
  const tagBuffer = Buffer.from(tag, "base64url");
  if (tagBuffer.length !== AUTH_TAG_LENGTH) {
    throw new Error("Unrecognized encrypted field format");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(iv, "base64url"), {
    authTagLength: AUTH_TAG_LENGTH,
  });
  if (aad !== undefined) decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tagBuffer);
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString(
    "utf8",
  );
}
