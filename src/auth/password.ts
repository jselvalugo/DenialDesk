import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt (memory-hard) with OWASP-recommended cost N=2^17, r=8, p=1. Built into Node: no dependency.
const N = 2 ** 17;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAX_MEM = 256 * 1024 * 1024;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { N: n, r, p, maxmem: MAX_MEM }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

/** Format: scrypt$N$r$p$salt$hash (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await derive(password, Buffer.from(salt, "base64url"), Number(n), Number(r), Number(p));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A valid hash of a random password, used to spend equal time when the account doesn't exist. */
let decoy: Promise<string> | undefined;
export function decoyHash(): Promise<string> {
  decoy ??= hashPassword(randomBytes(16).toString("hex"));
  return decoy;
}

/** NIST SP 800-63B: length over complexity (R-7.2.9). Breached-password screening arrives with SSO/IdP. */
export function passwordProblem(password: string): string | null {
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 128) return "Use at most 128 characters.";
  return null;
}
