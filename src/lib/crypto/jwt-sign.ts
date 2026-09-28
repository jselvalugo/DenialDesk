import { createPrivateKey, sign as cryptoSign, type KeyObject } from "node:crypto";

// Compact-JWT signing for SMART Backend Services client assertions (RFC 7523;
// docs/specs/patient-integrations.md PI2a "Token"). `node:crypto` only, no JOSE dependency. The
// signer is an interface, not a key: an Azure Key Vault key is non-exportable and signs remotely, so
// callers never assume the private key is in this process.

/** The algorithm allow-list (spec "Token"): ES384 (ECDSA P-384) or RS384 (RSASSA-PKCS1-v1_5, SHA-384). */
export const JWT_ALGS = ["ES384", "RS384"] as const;
export type JwtAlg = (typeof JWT_ALGS)[number];

export function isJwtAlg(value: unknown): value is JwtAlg {
  return typeof value === "string" && (JWT_ALGS as readonly string[]).includes(value);
}

export interface JwtSigner {
  readonly alg: JwtAlg;
  readonly kid: string;
  /** Raw JWS signature over `signingInput`: IEEE P1363 (R||S, 96 bytes) for ES384, PKCS#1 v1.5 for RS384. */
  sign(signingInput: Buffer): Promise<Buffer>;
}

const RSA_MIN_BITS = 2048;

/** The one algorithm a key can serve, or null when its type isn't on the allow-list. */
export function algForKey(key: KeyObject): JwtAlg | null {
  if (key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "secp384r1") return "ES384";
  if (key.asymmetricKeyType === "rsa" && (key.asymmetricKeyDetails?.modulusLength ?? 0) >= RSA_MIN_BITS) {
    return "RS384";
  }
  return null;
}

/** A signer over an in-process private key. Refuses a key whose type isn't on the allow-list. */
export function signerForPrivateKey(privateKey: KeyObject, kid: string): JwtSigner {
  if (privateKey.type !== "private") throw new Error("A private key is required to sign");
  const alg = algForKey(privateKey);
  if (!alg) throw new Error("Signing key must be ECDSA P-384 (ES384) or RSA of at least 2048 bits (RS384)");
  return {
    alg,
    kid,
    sign: async (signingInput) =>
      alg === "ES384"
        ? cryptoSign("sha384", signingInput, { key: privateKey, dsaEncoding: "ieee-p1363" })
        : cryptoSign("sha384", signingInput, privateKey),
  };
}

const b64u = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/** Signs `claims` as a compact JWT with header `{ alg, kid, typ: "JWT" }`. */
export async function signJwt(signer: JwtSigner, claims: Record<string, unknown>): Promise<string> {
  const header = { alg: signer.alg, kid: signer.kid, typ: "JWT" };
  const signingInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
  const signature = await signer.sign(Buffer.from(signingInput, "ascii"));
  // An adapter that returns an ASN.1 DER ECDSA signature (some Key Vault clients can) would be
  // rejected by every EHR; fail here, with no key or token material in the message.
  if (signer.alg === "ES384" && signature.length !== 96) {
    throw new Error("ES384 signature must be 96 bytes (IEEE P1363)");
  }
  return `${signingInput}.${b64u(signature)}`;
}

/** PKCS#8 DER (base64) round trip, for the encrypted-at-rest development key store. */
export function exportPrivateKey(key: KeyObject): string {
  return key.export({ format: "der", type: "pkcs8" }).toString("base64");
}

export function importPrivateKey(pkcs8Base64: string): KeyObject {
  return createPrivateKey({ key: Buffer.from(pkcs8Base64, "base64"), format: "der", type: "pkcs8" });
}
