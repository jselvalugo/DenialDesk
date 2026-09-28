import { generateKeyPairSync, randomBytes, verify as cryptoVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signJwt } from "@/lib/crypto/jwt-sign";
import {
  AzureKeyVaultKeyStore,
  getSigningKeyStore,
  jwksDocument,
  LocalEncryptedKeyStore,
  PUBLIC_JWK_FIELDS,
  pickPublicJwkFields,
  SigningKeyStoreError,
  thumbprintKid,
  toPublicJwk,
} from "./keys";

// Keys are generated at test time; nothing here is a committed secret.
const KEY = randomBytes(32);
const CONNECTION = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const synthetic = () => true;

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
});

describe("LocalEncryptedKeyStore (non-production)", () => {
  const store = () => new LocalEncryptedKeyStore(synthetic, KEY);

  it("refuses to exist where real data is allowed", () => {
    expect(() => new LocalEncryptedKeyStore(() => false, KEY)).toThrow(SigningKeyStoreError);
    try {
      new LocalEncryptedKeyStore(() => false, KEY);
    } catch (error) {
      expect((error as SigningKeyStoreError).code).toBe("not_permitted");
    }
  });

  it("creates an ES384 key whose reference is ciphertext, not a private key", async () => {
    const created = await store().create(CONNECTION);
    expect(created.alg).toBe("ES384");
    expect(created.keyRef.startsWith("local1:v1.")).toBe(true);
    expect(created.keyRef).not.toMatch(/PRIVATE KEY/);
  });

  it("signs with the stored key and publishes the matching public key (round trip)", async () => {
    const s = store();
    const created = await s.create(CONNECTION);
    const signer = await s.signer(CONNECTION, created.keyRef);
    expect(signer.kid).toBe(created.kid);
    const [jwk] = await s.publicJwks(CONNECTION, created.keyRef);
    expect(jwk).toMatchObject({ kty: "EC", crv: "P-384", alg: "ES384", use: "sig", kid: created.kid });

    const jwt = await signJwt(signer, { hello: "world" });
    const [h, p, sig] = jwt.split(".") as [string, string, string];
    const { createPublicKey } = await import("node:crypto");
    const publicKey = createPublicKey({ key: jwk as never, format: "jwk" });
    expect(
      cryptoVerify(
        "sha384",
        Buffer.from(`${h}.${p}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(sig, "base64url"),
      ),
    ).toBe(true);
  });

  it("each connection gets its own key", async () => {
    const s = store();
    const a = await s.create(CONNECTION);
    const b = await s.create(OTHER);
    expect(a.kid).not.toBe(b.kid);
    expect(a.keyRef).not.toBe(b.keyRef);
  });

  it("a key reference copied to another connection cannot be used (AAD binding)", async () => {
    const s = store();
    const created = await s.create(CONNECTION);
    await expect(s.signer(OTHER, created.keyRef)).rejects.toMatchObject({ code: "key_unreadable" });
    await expect(s.publicJwks(OTHER, created.keyRef)).rejects.toMatchObject({ code: "key_unreadable" });
  });

  it("refuses a reference with the wrong prefix, a tampered blob, or another encryption key", async () => {
    const s = store();
    const created = await s.create(CONNECTION);
    await expect(s.signer(CONNECTION, created.keyRef.replace("local1:", "vault:"))).rejects.toMatchObject({
      code: "key_unreadable",
    });
    const tampered = created.keyRef.slice(0, -3) + (created.keyRef.endsWith("AAA") ? "BBB" : "AAA");
    await expect(s.signer(CONNECTION, tampered)).rejects.toMatchObject({ code: "key_unreadable" });
    const other = new LocalEncryptedKeyStore(synthetic, randomBytes(32));
    await expect(other.signer(CONNECTION, created.keyRef)).rejects.toMatchObject({ code: "key_unreadable" });
  });

  it("the unreadable-key error message names nothing about the key", async () => {
    const s = store();
    const created = await s.create(CONNECTION);
    const error = await s.signer(OTHER, created.keyRef).then(
      () => new Error("Expected the call to reject"),
      (e: unknown) => e as Error,
    );
    expect(error.message).toBe("Signing key could not be read");
    expect(error.message).not.toContain(created.keyRef);
  });
});

describe("AzureKeyVaultKeyStore (production stub)", () => {
  it.each(["create", "signer", "publicJwks", "destroy"] as const)(
    "%s fails closed as not configured",
    async (method) => {
      const vault = new AzureKeyVaultKeyStore();
      const call = (vault[method] as unknown as (...args: unknown[]) => Promise<unknown>)(CONNECTION, "ref");
      await expect(call).rejects.toMatchObject({ code: "not_configured" });
      await expect(call).rejects.toThrow(/not configured/);
    },
  );
});

describe("getSigningKeyStore", () => {
  it("picks the local encrypted store only where only synthetic data is allowed", () => {
    expect(getSigningKeyStore(() => true)).toBeInstanceOf(LocalEncryptedKeyStore);
    expect(getSigningKeyStore(() => false)).toBeInstanceOf(AzureKeyVaultKeyStore);
  });
});
