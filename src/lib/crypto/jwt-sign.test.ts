import { generateKeyPairSync, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  algForKey,
  exportPrivateKey,
  importPrivateKey,
  isJwtAlg,
  signerForPrivateKey,
  signJwt,
  type JwtSigner,
} from "./jwt-sign";

// Keys are generated at test time; no key material is committed (spec PI2a; CLAUDE.md #1).
const ec384 = () => generateKeyPairSync("ec", { namedCurve: "secp384r1" });
const rsa = (bits = 2048) => generateKeyPairSync("rsa", { modulusLength: bits });

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

function verifyJwt(jwt: string, publicKey: KeyObject, alg: "ES384" | "RS384"): boolean {
  const [h, p, s] = jwt.split(".") as [string, string, string];
  const data = Buffer.from(`${h}.${p}`, "ascii");
  const signature = Buffer.from(s, "base64url");
  return alg === "ES384"
    ? cryptoVerify("sha384", data, { key: publicKey, dsaEncoding: "ieee-p1363" }, signature)
    : cryptoVerify("sha384", data, publicKey, signature);
}

describe("signJwt", () => {
  it("signs ES384 with header { alg, kid, typ: JWT } and a 96-byte P1363 signature that verifies", async () => {
    const { privateKey, publicKey } = ec384();
    const jwt = await signJwt(signerForPrivateKey(privateKey, "kid-1"), { iss: "c", n: 1 });
    const [h, p, s] = jwt.split(".") as [string, string, string];
    expect(decode(h)).toEqual({ alg: "ES384", kid: "kid-1", typ: "JWT" });
    expect(decode(p)).toEqual({ iss: "c", n: 1 });
    expect(Buffer.from(s, "base64url")).toHaveLength(96);
    expect(verifyJwt(jwt, publicKey, "ES384")).toBe(true);
  });

  it("signs RS384 and the signature verifies", async () => {
    const { privateKey, publicKey } = rsa();
    const jwt = await signJwt(signerForPrivateKey(privateKey, "kid-2"), { iss: "c" });
    expect(decode(jwt.split(".")[0]!)).toEqual({ alg: "RS384", kid: "kid-2", typ: "JWT" });
    expect(verifyJwt(jwt, publicKey, "RS384")).toBe(true);
  });

  it("a tampered payload no longer verifies", async () => {
    const { privateKey, publicKey } = ec384();
    const jwt = await signJwt(signerForPrivateKey(privateKey, "k"), { iss: "c" });
    const [h, , s] = jwt.split(".") as [string, string, string];
    const forged = `${h}.${Buffer.from(JSON.stringify({ iss: "attacker" })).toString("base64url")}.${s}`;
    expect(verifyJwt(forged, publicKey, "ES384")).toBe(false);
  });

  it("refuses an ES384 signature that is not IEEE P1363 (an ASN.1 DER signature from a vault client)", async () => {
    const { privateKey } = ec384();
    const der: JwtSigner = {
      alg: "ES384",
      kid: "k",
      sign: async () => Buffer.alloc(102, 1),
    };
    await expect(signJwt(der, {})).rejects.toThrow(/96 bytes/);
    // Sanity: the real signer is fine.
    await expect(signJwt(signerForPrivateKey(privateKey, "k"), {})).resolves.toBeTypeOf("string");
  });
});

describe("algorithm allow-list", () => {
  it("accepts only ES384 and RS384", () => {
    expect(isJwtAlg("ES384")).toBe(true);
    expect(isJwtAlg("RS384")).toBe(true);
    for (const other of ["none", "HS256", "RS256", "ES256", "PS384", "es384", "", undefined, 1]) {
      expect(isJwtAlg(other)).toBe(false);
    }
  });

  it("maps a P-384 key to ES384 and a 2048-bit RSA key to RS384", () => {
    expect(algForKey(ec384().privateKey)).toBe("ES384");
    expect(algForKey(rsa().privateKey)).toBe("RS384");
  });

  it("refuses keys that are not on the allow-list", () => {
    const p256 = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    expect(() => signerForPrivateKey(p256.privateKey, "k")).toThrow(/ES384/);
    expect(() => signerForPrivateKey(rsa(1024).privateKey, "k")).toThrow(/RS384/);
    const ed = generateKeyPairSync("ed25519");
    expect(() => signerForPrivateKey(ed.privateKey, "k")).toThrow();
  });

  it("refuses a public key as a signer", () => {
    const { publicKey } = ec384();
    expect(() => signerForPrivateKey(publicKey, "k")).toThrow(/private key/);
  });
});

describe("private key round trip", () => {
  it("exports and re-imports a PKCS#8 key that signs the same identity", async () => {
    const { privateKey, publicKey } = ec384();
    const restored = importPrivateKey(exportPrivateKey(privateKey));
    const jwt = await signJwt(signerForPrivateKey(restored, "k"), { a: 1 });
    expect(verifyJwt(jwt, publicKey, "ES384")).toBe(true);
  });
});
