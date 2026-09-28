import { createHash, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { algForKey, signerForPrivateKey, type JwtAlg, type JwtSigner } from "@/lib/crypto/jwt-sign";
import { syntheticDataOnly } from "@/lib/env";

// Signing-key storage behind an adapter (docs/specs/patient-integrations.md PI2a "Keys";
// R-7.3.4, R-7.3.5; ADR 0010). The adapter owns everything that touches private key material;
// callers get a signer or public JWKs. Private keys are **Secret** (spec "Classification"): never
// logged, never audited, never returned, never written to the database.
//
// Pre-production (`syntheticDataOnly()`): one shared key from a functions-only hosting secret
// (`EnvSharedKeyStore`). Production: a non-exportable per-connection Azure Key Vault key at the
// Azure cutover (`AzureKeyVaultKeyStore`, a fail-closed stub until then; the grant on
// `key_mode`/`key_ref` and the definer lookup it needs are R-15.9 changes, see the spec).

/** The environment variable holding the pre-production signing key (PKCS#8 PEM, ES384). */
export const SIGNING_KEY_ENV = "INTEGRATION_SIGNING_KEY";

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

export type KeyStoreErrorCode =
  "not_configured" | "key_unreadable" | "not_permitted" | "env_key_in_production";

const KEY_STORE_MESSAGES: Record<KeyStoreErrorCode, string> = {
  not_configured: "Signing key store is not configured",
  key_unreadable: "Signing key could not be read",
  not_permitted: "Signing key store is not permitted in this environment",
  env_key_in_production:
    "An environment signing key is present where real data is allowed; integrations refuse to start (R-7.3.5)",
};

/** Carries only a code: never key material, a PEM fragment, or underlying error text. */
export class SigningKeyStoreError extends Error {
  constructor(readonly code: KeyStoreErrorCode) {
    super(KEY_STORE_MESSAGES[code]);
    this.name = "SigningKeyStoreError";
  }
}

export interface SigningKeyStore {
  /** A signer for the connection's key (the pre-production store has one key for every connection). */
  signer(connectionId: string): Promise<JwtSigner>;
  /** Every currently published key (current, and `next` once rotation ships), public fields only. */
  publicJwks(connectionId: string): Promise<PublicJwk[]>;
}

/**
 * Pre-production adapter: one shared ES384 (or RS384) key from `INTEGRATION_SIGNING_KEY`, a PKCS#8 PEM
 * in a functions-only hosting secret, distinct from any production key (spec "Keys"). Refuses to
 * exist where real data is allowed. The key is parsed on first use and held in memory only; a missing
 * variable is `not_configured` at use, not at construction, so the app and the JWKS route start
 * without it. Literal `\n` sequences are accepted for hosts that flatten multi-line secrets.
 */
export class EnvSharedKeyStore implements SigningKeyStore {
  // True `#private` fields (not TypeScript `private`): neither the PEM nor the parsed key is an own
  // property, so `JSON.stringify`, `util.inspect`, `structuredClone`, and a logger that walks the
  // object can never reach them. The variable is read inside `#load()`, on first use.
  readonly #source: () => string | undefined;
  #loaded: { key: KeyObject; alg: JwtAlg; kid: string } | undefined;

  constructor(synthetic: () => boolean = syntheticDataOnly, pem?: string) {
    if (!synthetic()) throw new SigningKeyStoreError("not_permitted");
    this.#source = pem === undefined ? () => process.env[SIGNING_KEY_ENV] : () => pem;
  }

  #load(): { key: KeyObject; alg: JwtAlg; kid: string } {
    if (this.#loaded) return this.#loaded;
    const text = this.#source()?.replace(/\\n/g, "\n").trim();
    if (!text) throw new SigningKeyStoreError("not_configured");
    try {
      // PKCS#8 only (spec): a SEC1 "EC PRIVATE KEY" or "RSA PRIVATE KEY" block is refused.
      if (!text.startsWith("-----BEGIN PRIVATE KEY-----")) throw new Error("not pkcs8");
      const key = createPrivateKey({ key: text, format: "pem" });
      const alg = algForKey(key);
      if (!alg) throw new Error("not allowed");
      this.#loaded = { key, alg, kid: thumbprintKid(key) };
    } catch {
      // Say nothing about why: the parser's message can quote the PEM.
      throw new SigningKeyStoreError("key_unreadable");
    }
    return this.#loaded;
  }

  async signer(): Promise<JwtSigner> {
    const { key, kid } = this.#load();
    return signerForPrivateKey(key, kid);
  }

  async publicJwks(): Promise<PublicJwk[]> {
    const { key, alg, kid } = this.#load();
    return [toPublicJwk(key, kid, alg)];
  }
}

/**
 * Production adapter placeholder (spec: a non-exportable Azure Key Vault key per connection, at the
 * Azure cutover, with the Key Vault SDK reviewed under R-15.7). Every call fails closed until then.
 */
export class AzureKeyVaultKeyStore implements SigningKeyStore {
  signer(): Promise<JwtSigner> {
    return Promise.reject(new SigningKeyStoreError("not_configured"));
  }
  publicJwks(): Promise<PublicJwk[]> {
    return Promise.reject(new SigningKeyStoreError("not_configured"));
  }
}

/**
 * "Production refuses to start integrations if an env signing key is present (Key Vault only)":
 * where real data is allowed, a set `INTEGRATION_SIGNING_KEY` is a misconfiguration (a Secret in the
 * wrong place), not something to ignore.
 */
export function assertNoEnvSigningKeyInProduction(
  synthetic: () => boolean = syntheticDataOnly,
  env: Record<string, string | undefined> = process.env,
): void {
  if (!synthetic() && (env[SIGNING_KEY_ENV] ?? "").trim() !== "") {
    throw new SigningKeyStoreError("env_key_in_production");
  }
}

/** The adapter for this environment: the shared env key where only synthetic data is allowed, else Key Vault. */
export function getSigningKeyStore(
  synthetic: () => boolean = syntheticDataOnly,
  env: Record<string, string | undefined> = process.env,
): SigningKeyStore {
  if (synthetic()) return new EnvSharedKeyStore(synthetic, env[SIGNING_KEY_ENV]);
  assertNoEnvSigningKeyInProduction(synthetic, env);
  return new AzureKeyVaultKeyStore();
}

/** The JWKS document body for a set of public keys. */
export function jwksDocument(keys: readonly PublicJwk[]): { keys: PublicJwk[] } {
  return { keys: [...keys] };
}
