import { createHash, createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { decryptField, encryptField } from "@/lib/crypto/field";
import {
  algForKey,
  exportPrivateKey,
  importPrivateKey,
  signerForPrivateKey,
  type JwtAlg,
  type JwtSigner,
} from "@/lib/crypto/jwt-sign";
import { syntheticDataOnly } from "@/lib/env";

// Signing-key storage behind an adapter (docs/specs/patient-integrations.md PI2a "Keys";
// R-7.3.4, R-7.3.5; ADR 0010). One key per connection by default. The adapter owns everything that
// touches private key material; callers hold only an opaque `keyRef` (the `key_ref` column) and get
// back a signer or public JWKs. Private keys are **Secret** (spec "Classification"): never logged,
// never audited, never returned.

/** The fields a JWKS may publish (spec "JWKS routes"); everything else is dropped, never copied. */
export const PUBLIC_JWK_FIELDS = ["kty", "crv", "x", "y", "n", "e", "kid", "alg", "use"] as const;

export interface PublicJwk {
  kty: "EC" | "RSA";
  crv?: string;
  x?: string;
  y?: string;
  n?: string;
  e?: string;
  kid: string;
  alg: JwtAlg;
  use: "sig";
}

/**
 * Copies only the allow-listed string fields (never deletes the private ones), so a field a future
 * Node version or a Key Vault client adds to an export (`d`, `p`, `q`, `dp`, `dq`, `qi`, `k`,
 * `key_ops`, `ext`, ...) can't leak into a JWKS. Exported for the JWKS route's own last-line check.
 */
export function pickPublicJwkFields(raw: Record<string, unknown>): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const field of PUBLIC_JWK_FIELDS) {
    const value = raw[field];
    if (typeof value === "string") picked[field] = value;
  }
  return picked;
}

/** The public half of a key object (`createPublicKey` accepts only a private key object, or PEM/DER/JWK). */
function publicHalf(key: KeyObject): KeyObject {
  return key.type === "public" ? key : createPublicKey(key);
}

/** A public JWK for `key` (a private or public key object), with our `kid`, `alg`, and `use: "sig"`. */
export function toPublicJwk(key: KeyObject, kid: string, alg: JwtAlg): PublicJwk {
  const raw = publicHalf(key).export({ format: "jwk" }) as Record<string, unknown>;
  return { ...pickPublicJwkFields(raw), kid, alg, use: "sig" } as unknown as PublicJwk;
}

/** RFC 7638 thumbprint (SHA-256, base64url) of the public key: a stable `kid` with no secret in it. */
export function thumbprintKid(key: KeyObject): string {
  const raw = publicHalf(key).export({ format: "jwk" }) as Record<string, string>;
  const members =
    raw.kty === "EC"
      ? { crv: raw.crv, kty: raw.kty, x: raw.x, y: raw.y }
      : { e: raw.e, kty: raw.kty, n: raw.n };
  return createHash("sha256").update(JSON.stringify(members)).digest("base64url");
}

export type KeyStoreErrorCode = "not_configured" | "key_unreadable" | "not_permitted";

/** Carries only a code: never a key reference, blob, or underlying error text. */
export class SigningKeyStoreError extends Error {
  constructor(readonly code: KeyStoreErrorCode) {
    super(
      code === "not_configured"
        ? "Signing key store is not configured"
        : code === "not_permitted"
          ? "Signing key store is not permitted in this environment"
          : "Signing key could not be read",
    );
    this.name = "SigningKeyStoreError";
  }
}

export interface CreatedKey {
  /** Opaque; stored in `integration_connections.key_ref`. */
  keyRef: string;
  kid: string;
  alg: JwtAlg;
}

export interface SigningKeyStore {
  /** `key_mode` this store records for a key it creates. */
  readonly keyMode: "per_connection" | "preprod_shared";
  create(connectionId: string): Promise<CreatedKey>;
  signer(connectionId: string, keyRef: string): Promise<JwtSigner>;
  /** Every currently published key (current, and `next` once rotation ships), public fields only. */
  publicJwks(connectionId: string, keyRef: string): Promise<PublicJwk[]>;
  /** Destroys the key material (revoke). The caller clears `key_ref` in the same transaction. */
  destroy(connectionId: string, keyRef: string): Promise<void>;
}

const LOCAL_PREFIX = "local1:";

/**
 * Non-production adapter (`syntheticDataOnly()`, i.e. local, CI, and every Netlify deploy): a fresh
 * ES384 key per connection, PKCS#8-encoded and encrypted with AES-256-GCM by the project's field
 * encryption (R-7.3.3), bound by AAD to its own connection so a blob copied to another connection
 * fails to decrypt. The ciphertext *is* the `key_ref`. It refuses to run anywhere real data could
 * exist. Synthetic sandboxes only: a key stored this way is not Key Vault-grade.
 */
export class LocalEncryptedKeyStore implements SigningKeyStore {
  readonly keyMode = "per_connection" as const;

  constructor(
    private readonly synthetic: () => boolean = syntheticDataOnly,
    private readonly encryptionKey?: Buffer,
  ) {
    if (!synthetic()) throw new SigningKeyStoreError("not_permitted");
  }

  private aad(connectionId: string): string {
    return `integration_signing_key|${connectionId}`;
  }

  async create(connectionId: string): Promise<CreatedKey> {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
    const blob = encryptField(exportPrivateKey(privateKey), this.encryptionKey, this.aad(connectionId));
    return { keyRef: `${LOCAL_PREFIX}${blob}`, kid: thumbprintKid(privateKey), alg: "ES384" };
  }

  private load(connectionId: string, keyRef: string): KeyObject {
    if (!keyRef.startsWith(LOCAL_PREFIX)) throw new SigningKeyStoreError("key_unreadable");
    try {
      return importPrivateKey(
        decryptField(keyRef.slice(LOCAL_PREFIX.length), this.encryptionKey, this.aad(connectionId)),
      );
    } catch {
      // Decryption or parse failure: say nothing about why.
      throw new SigningKeyStoreError("key_unreadable");
    }
  }

  async signer(connectionId: string, keyRef: string): Promise<JwtSigner> {
    const key = this.load(connectionId, keyRef);
    return signerForPrivateKey(key, thumbprintKid(key));
  }

  async publicJwks(connectionId: string, keyRef: string): Promise<PublicJwk[]> {
    const key = this.load(connectionId, keyRef);
    const alg = algForKey(key);
    if (!alg) throw new SigningKeyStoreError("key_unreadable");
    return [toPublicJwk(key, thumbprintKid(key), alg)];
  }

  async destroy(): Promise<void> {
    // The ciphertext lives only in `key_ref`; the caller nulling that column destroys the key.
  }
}

/**
 * Production adapter placeholder (spec: a non-exportable Azure Key Vault key per connection, at the
 * Azure cutover, with the Key Vault SDK reviewed under R-15.7). Every call fails closed until then.
 */
export class AzureKeyVaultKeyStore implements SigningKeyStore {
  readonly keyMode = "per_connection" as const;
  create(): Promise<CreatedKey> {
    return Promise.reject(new SigningKeyStoreError("not_configured"));
  }
  signer(): Promise<JwtSigner> {
    return Promise.reject(new SigningKeyStoreError("not_configured"));
  }
  publicJwks(): Promise<PublicJwk[]> {
    return Promise.reject(new SigningKeyStoreError("not_configured"));
  }
  destroy(): Promise<void> {
    return Promise.reject(new SigningKeyStoreError("not_configured"));
  }
}

/** The adapter for this environment: local encrypted keys where only synthetic data is allowed, else Key Vault. */
export function getSigningKeyStore(synthetic: () => boolean = syntheticDataOnly): SigningKeyStore {
  return synthetic() ? new LocalEncryptedKeyStore(synthetic) : new AzureKeyVaultKeyStore();
}

/** The JWKS document body for a set of public keys. */
export function jwksDocument(keys: readonly PublicJwk[]): { keys: PublicJwk[] } {
  return { keys: [...keys] };
}
