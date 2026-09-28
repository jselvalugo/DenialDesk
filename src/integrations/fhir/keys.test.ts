import { createPublicKey, generateKeyPairSync, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { signJwt } from "@/lib/crypto/jwt-sign";
import {
  assertNoEnvSigningKeyInProduction,
  AzureKeyVaultKeyStore,
  EnvSharedKeyStore,
  getSigningKeyStore,
  jwksDocument,
  PUBLIC_JWK_FIELDS,
  pickPublicJwkFields,
  SIGNING_KEY_ENV,
  SigningKeyStoreError,
  thumbprintKid,
  toPublicJwk,
} from "./keys";

// Keys are generated at test time; nothing here is a committed secret.
const synthetic = () => true;
const production = () => false;

/** A fresh PKCS#8 PEM, as an operator would put in the hosting secret. */
function pkcs8Pem(privateKey: KeyObject): string {
  return privateKey.export({ format: "pem", type: "pkcs8" }).toString();
}
const es384 = () => generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey;

/** Private-field names a JWKS must never carry (RFC 7518 §6.2.2, §6.3.2, §6.4). */
const PRIVATE_FIELDS = ["d", "p", "q", "dp", "dq", "qi", "oth", "k"];

function keysOf(json: string): string[] {
  const parsed = JSON.parse(json) as { keys: Record<string, unknown>[] };
  return parsed.keys.flatMap((key) => Object.keys(key));
}

describe("JWKS public-field allow-list (threat model I10)", () => {
  it("publishes only kty, crv, x, y, n, e, kid, alg, use for an EC key", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
    const jwk = toPublicJwk(privateKey, "kid-a", "ES384");
    expect(Object.keys(jwk).sort()).toEqual(["alg", "crv", "kid", "kty", "use", "x", "y"]);
    expect(jwk).toMatchObject({ kty: "EC", crv: "P-384", alg: "ES384", use: "sig", kid: "kid-a" });
  });

  it("publishes only the allow-listed fields for an RSA key", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = toPublicJwk(privateKey, "kid-b", "RS384");
    expect(Object.keys(jwk).sort()).toEqual(["alg", "e", "kid", "kty", "n", "use"]);
  });

  it.each([
    ["EC", () => generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey, "ES384" as const],
    ["RSA", () => generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey, "RS384" as const],
  ])("a %s JWKS document carries no private field (d, p, q, dp, dq, qi, ...)", (_name, make, alg) => {
    const privateKey = make();
    // The private half exists and would export `d`; prove the document still doesn't carry it.
    expect(Object.keys(privateKey.export({ format: "jwk" }))).toContain("d");
    const json = JSON.stringify(jwksDocument([toPublicJwk(privateKey, "k", alg)]));
    const names = keysOf(json);
    for (const field of PRIVATE_FIELDS) expect(names).not.toContain(field);
    for (const name of names) expect(PUBLIC_JWK_FIELDS as readonly string[]).toContain(name);
  });

  it("drops every non-allow-listed field from a raw export, including private ones a library might add", () => {
    const raw = {
      kty: "RSA",
      n: "n-value",
      e: "AQAB",
      d: "SECRET",
      p: "SECRET",
      q: "SECRET",
      dp: "SECRET",
      dq: "SECRET",
      qi: "SECRET",
      k: "SECRET",
      key_ops: ["sign"],
      ext: true,
      x5c: ["chain"],
      kid: "from-raw",
      nested: { d: "SECRET" },
    };
    const picked = pickPublicJwkFields(raw);
    expect(picked).toEqual({ kty: "RSA", n: "n-value", e: "AQAB", kid: "from-raw" });
    expect(JSON.stringify(picked)).not.toContain("SECRET");
  });

  it("ignores non-string values for an allow-listed name", () => {
    expect(pickPublicJwkFields({ kty: "EC", x: 5, y: null, crv: ["P-384"] })).toEqual({ kty: "EC" });
  });
});

describe("thumbprintKid", () => {
  it("is a stable base64url SHA-256 (RFC 7638) of the public key, the same from either half", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
    const kid = thumbprintKid(privateKey);
    expect(kid).toBe(thumbprintKid(publicKey));
    expect(kid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(thumbprintKid(generateKeyPairSync("ec", { namedCurve: "secp384r1" }).privateKey)).not.toBe(kid);
  });

  // Known-answer tests: the expected values do not come from this implementation.
  it("matches the RFC 7638 section 3.1 RSA example", () => {
    // The public key and thumbprint printed in RFC 7638 section 3.1 (https://www.rfc-editor.org/rfc/rfc7638#section-3.1).
    const jwk = {
      kty: "RSA",
      n: "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-kEgU8awapJzKnqDKgw",
      e: "AQAB",
    };
    expect(thumbprintKid(createPublicKey({ key: jwk, format: "jwk" }))).toBe(
      "NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs",
    );
  });

  it("matches an EC P-384 vector whose expected value was computed independently (SHA-256 of the RFC 7638 canonical JSON, in Python)", () => {
    const jwk = {
      kty: "EC",
      crv: "P-384",
      x: "KNUzHIB4tqauE-6q0PbMfjrw68yAPA--QoY7m8YzVnB8c2L7le-hfn07vLNyQi6F",
      y: "nPRGqziHjiK199xVjyPy4xf6e-CBy01asYRgf_A68YsZ2crvYBJMligU5sRbA46s",
    };
    expect(thumbprintKid(createPublicKey({ key: jwk, format: "jwk" }))).toBe(
      "mMV_Up0Ie3-XPDx42VfK9SaNg7nbY-KaS1B_nQYSDHE",
    );
  });
});

describe("EnvSharedKeyStore (pre-production, INTEGRATION_SIGNING_KEY)", () => {
  it("refuses to exist where real data is allowed", () => {
    expect(() => new EnvSharedKeyStore(production, pkcs8Pem(es384()))).toThrow(SigningKeyStoreError);
    try {
      new EnvSharedKeyStore(production, pkcs8Pem(es384()));
    } catch (error) {
      expect((error as SigningKeyStoreError).code).toBe("not_permitted");
    }
  });

  it("constructs without a key and reports not_configured on use (the app and the JWKS route start without it)", async () => {
    for (const pem of ["", "   \n "]) {
      const store = new EnvSharedKeyStore(synthetic, pem);
      await expect(store.signer()).rejects.toMatchObject({ code: "not_configured" });
      await expect(store.publicJwks()).rejects.toMatchObject({ code: "not_configured" });
    }
  });

  it("signs with the key and publishes the matching public key (round trip)", async () => {
    const privateKey = es384();
    const store = new EnvSharedKeyStore(synthetic, pkcs8Pem(privateKey));
    const signer = await store.signer();
    expect(signer).toMatchObject({ alg: "ES384", kid: thumbprintKid(privateKey) });
    const [jwk] = await store.publicJwks();
    expect(jwk).toMatchObject({ kty: "EC", crv: "P-384", alg: "ES384", use: "sig", kid: signer.kid });

    const jwt = await signJwt(signer, { hello: "world" });
    const [h, p, sig] = jwt.split(".") as [string, string, string];
    expect(
      cryptoVerify(
        "sha384",
        Buffer.from(`${h}.${p}`),
        { key: createPublicKey({ key: jwk as never, format: "jwk" }), dsaEncoding: "ieee-p1363" },
        Buffer.from(sig, "base64url"),
      ),
    ).toBe(true);
  });

  it("the same key serves every connection (one shared key, spec 'Keys')", async () => {
    const store = new EnvSharedKeyStore(synthetic, pkcs8Pem(es384()));
    expect((await store.signer()).kid).toBe((await store.signer()).kid);
    expect(await store.publicJwks()).toHaveLength(1);
  });

  it("accepts a PEM whose newlines were flattened to a literal backslash-n", async () => {
    const privateKey = es384();
    const flattened = pkcs8Pem(privateKey).trim().replace(/\n/g, "\\n");
    const store = new EnvSharedKeyStore(synthetic, flattened);
    expect((await store.signer()).kid).toBe(thumbprintKid(privateKey));
  });

  it("accepts an RS384-capable RSA key too (the allow-list is ES384 or RS384)", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const store = new EnvSharedKeyStore(synthetic, pkcs8Pem(privateKey));
    expect((await store.signer()).alg).toBe("RS384");
    expect((await store.publicJwks())[0]).toMatchObject({ kty: "RSA", alg: "RS384" });
  });

  it.each([
    ["garbage", "not a pem"],
    [
      "a public key",
      () =>
        generateKeyPairSync("ec", { namedCurve: "secp384r1" })
          .publicKey.export({ format: "pem", type: "spki" })
          .toString(),
    ],
    [
      "a SEC1 EC PRIVATE KEY block (PKCS#8 only)",
      () => es384().export({ format: "pem", type: "sec1" }).toString(),
    ],
    [
      "a P-256 key (not ES384)",
      () => pkcs8Pem(generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey),
    ],
    ["a 1024-bit RSA key", () => pkcs8Pem(generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey)],
    ["an Ed25519 key", () => pkcs8Pem(generateKeyPairSync("ed25519").privateKey)],
  ])("refuses %s as key_unreadable, with a message that quotes nothing", async (_name, make) => {
    const pem = typeof make === "function" ? make() : make;
    const store = new EnvSharedKeyStore(synthetic, pem);
    const error = await store.signer().then(
      () => new Error("Expected the call to reject"),
      (e: unknown) => e as SigningKeyStoreError,
    );
    expect(error).toBeInstanceOf(SigningKeyStoreError);
    expect((error as SigningKeyStoreError).code).toBe("key_unreadable");
    expect(error.message).toBe("Signing key could not be read");
  });

  it("with the environment variable absent the default store is not_configured", async () => {
    const saved = process.env[SIGNING_KEY_ENV];
    delete process.env[SIGNING_KEY_ENV];
    try {
      await expect(new EnvSharedKeyStore(synthetic).signer()).rejects.toMatchObject({
        code: "not_configured",
      });
    } finally {
      if (saved !== undefined) process.env[SIGNING_KEY_ENV] = saved;
    }
  });

  it("reads INTEGRATION_SIGNING_KEY from the environment by default", async () => {
    const privateKey = es384();
    const saved = process.env[SIGNING_KEY_ENV];
    process.env[SIGNING_KEY_ENV] = pkcs8Pem(privateKey);
    try {
      expect((await new EnvSharedKeyStore(synthetic).signer()).kid).toBe(thumbprintKid(privateKey));
    } finally {
      if (saved === undefined) delete process.env[SIGNING_KEY_ENV];
      else process.env[SIGNING_KEY_ENV] = saved;
    }
  });

  it("M1: the store never serializes the key: not through inspect, JSON, or structuredClone, before or after use", async () => {
    const privateKey = es384();
    const pem = pkcs8Pem(privateKey);
    const body = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
    const store = new EnvSharedKeyStore(synthetic, pem);
    const shown = () =>
      [
        inspect(store, { depth: 6, showHidden: true }),
        JSON.stringify(store),
        String(Object.keys(store)),
        String(Object.getOwnPropertyNames(store)),
        String(Object.getOwnPropertySymbols(store).map(String)),
      ].join("|");
    for (const phase of ["before", "after"]) {
      const text = shown();
      expect(text, phase).not.toContain("PRIVATE KEY");
      expect(text, phase).not.toContain(body.slice(20, 60));
      expect(Object.keys(store), phase).toEqual([]);
      if (phase === "before") await store.signer(); // load the key, then look again
    }
    // structuredClone of a class instance keeps only own enumerable data: nothing to leak either.
    expect(JSON.stringify(structuredClone(store))).not.toContain("PRIVATE KEY");
  });

  it("M1: the environment variable is read on use, not at construction, and never kept as a property", async () => {
    const saved = process.env[SIGNING_KEY_ENV];
    delete process.env[SIGNING_KEY_ENV];
    try {
      const store = new EnvSharedKeyStore(synthetic);
      process.env[SIGNING_KEY_ENV] = pkcs8Pem(es384());
      await expect(store.signer()).resolves.toMatchObject({ alg: "ES384" });
      expect(inspect(store, { showHidden: true })).not.toContain("PRIVATE KEY");
    } finally {
      if (saved === undefined) delete process.env[SIGNING_KEY_ENV];
      else process.env[SIGNING_KEY_ENV] = saved;
    }
  });

  it("never publishes private fields from the shared key", async () => {
    const store = new EnvSharedKeyStore(synthetic, pkcs8Pem(es384()));
    const json = JSON.stringify(jwksDocument(await store.publicJwks()));
    for (const field of PRIVATE_FIELDS) expect(keysOf(json)).not.toContain(field);
  });
});

describe("AzureKeyVaultKeyStore (production stub)", () => {
  it.each(["signer", "publicJwks"] as const)("%s fails closed as not configured", async (method) => {
    const vault = new AzureKeyVaultKeyStore();
    const call = vault[method]();
    await expect(call).rejects.toMatchObject({ code: "not_configured" });
    await expect(call).rejects.toThrow(/not configured/);
  });
});

describe("production refuses an environment signing key (spec 'Keys', R-7.3.5)", () => {
  const withKey = { [SIGNING_KEY_ENV]: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----" };

  it("throws env_key_in_production where real data is allowed and the variable is set", () => {
    expect(() => assertNoEnvSigningKeyInProduction(production, withKey)).toThrow(SigningKeyStoreError);
    expect(() => getSigningKeyStore(production, withKey)).toThrow(/refuse to start/);
    try {
      getSigningKeyStore(production, withKey);
    } catch (error) {
      expect((error as SigningKeyStoreError).code).toBe("env_key_in_production");
      expect((error as Error).message).not.toContain("BEGIN");
    }
  });

  it("is fine in production when the variable is absent or blank", () => {
    for (const env of [{}, { [SIGNING_KEY_ENV]: "" }, { [SIGNING_KEY_ENV]: "  " }]) {
      expect(() => assertNoEnvSigningKeyInProduction(production, env)).not.toThrow();
      expect(getSigningKeyStore(production, env)).toBeInstanceOf(AzureKeyVaultKeyStore);
    }
  });

  it("is allowed where only synthetic data is allowed (every Netlify deploy)", () => {
    expect(() => assertNoEnvSigningKeyInProduction(synthetic, withKey)).not.toThrow();
  });
});

describe("getSigningKeyStore", () => {
  it("picks the env shared-key store only where only synthetic data is allowed, else Key Vault", () => {
    expect(getSigningKeyStore(synthetic, {})).toBeInstanceOf(EnvSharedKeyStore);
    expect(getSigningKeyStore(production, {})).toBeInstanceOf(AzureKeyVaultKeyStore);
  });
});
