import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleJwksRequest } from "./jwks-route";
import { AzureKeyVaultKeyStore, EnvSharedKeyStore, PUBLIC_JWK_FIELDS, type SigningKeyStore } from "./keys";

const allowed = async () => ({ allowed: true, retryAfterSeconds: 0 });
const pem = () =>
  generateKeyPairSync("ec", { namedCurve: "secp384r1" })
    .privateKey.export({ format: "pem", type: "pkcs8" })
    .toString();
const preprod = (key: string | undefined | null = pem()) => ({
  limit: allowed,
  synthetic: () => true,
  store: () => new EnvSharedKeyStore(() => true, key ?? ""),
});

describe("handleJwksRequest (/.well-known/jwks.json, spec PI2a 'JWKS routes')", () => {
  it("publishes the shared key's public JWK with the spec's cache header and JWKS media type", async () => {
    const response = await handleJwksRequest(preprod());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("content-type")).toBe("application/jwk-set+json");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = (await response.json()) as { keys: Record<string, string>[] };
    expect(body.keys).toHaveLength(1);
    expect(body.keys[0]).toMatchObject({ kty: "EC", crv: "P-384", alg: "ES384", use: "sig" });
    expect(body.keys[0]!.kid).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("never exposes a private field: only the allow-listed names, and no d, p, q, dp, dq, qi, k", async () => {
    const text = await (await handleJwksRequest(preprod())).text();
    const names = (JSON.parse(text) as { keys: object[] }).keys.flatMap((key) => Object.keys(key));
    for (const name of names) expect(PUBLIC_JWK_FIELDS as readonly string[]).toContain(name);
    for (const field of ["d", "p", "q", "dp", "dq", "qi", "k", "oth"]) expect(names).not.toContain(field);
    expect(text).not.toContain("PRIVATE");
  });

  it("re-applies the allow-list to whatever the adapter returns (a leaky adapter can't publish `d`)", async () => {
    const leaky: SigningKeyStore = {
      signer: () => Promise.reject(new Error("unused")),
      kid: () => Promise.reject(new Error("unused")),
      publicJwks: async () =>
        [
          {
            kty: "EC",
            crv: "P-384",
            x: "x",
            y: "y",
            kid: "k",
            alg: "ES384",
            use: "sig",
            d: "SECRET",
            key_ops: ["sign"],
          },
        ] as never,
    };
    const response = await handleJwksRequest({ limit: allowed, synthetic: () => true, store: () => leaky });
    const text = await response.text();
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("key_ops");
    expect(JSON.parse(text)).toEqual({
      keys: [{ kty: "EC", crv: "P-384", x: "x", y: "y", kid: "k", alg: "ES384", use: "sig" }],
    });
  });

  it("is 404 (uncached) when INTEGRATION_SIGNING_KEY isn't set, and when it isn't a usable key", async () => {
    for (const key of [null, "", "not a pem"]) {
      const response = await handleJwksRequest(preprod(key));
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("");
    }
  });

  it("L5: is 404 where real data is allowed, before rate limiting and without building the key store", async () => {
    const store = vi.fn(() => new AzureKeyVaultKeyStore());
    const limit = vi.fn(allowed);
    const response = await handleJwksRequest({ limit, synthetic: () => false, store });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    // No rate-limit hit (a database write) for an anonymous request that can never be served.
    expect(limit).not.toHaveBeenCalled();
    expect(store).not.toHaveBeenCalled();
  });

  it("is 429 with Retry-After when the jwks bucket is exhausted, before touching the key", async () => {
    const store = vi.fn(() => new EnvSharedKeyStore(() => true, pem()));
    const response = await handleJwksRequest({
      limit: async () => ({ allowed: false, retryAfterSeconds: 42 }),
      synthetic: () => true,
      store,
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(store).not.toHaveBeenCalled();
  });

  it("rethrows an unexpected failure (a bug is a 500, not a 404)", async () => {
    const broken: SigningKeyStore = {
      signer: () => Promise.reject(new Error("x")),
      kid: () => Promise.reject(new Error("x")),
      publicJwks: () => Promise.reject(new TypeError("bug")),
    };
    await expect(
      handleJwksRequest({ limit: allowed, synthetic: () => true, store: () => broken }),
    ).rejects.toThrow("bug");
  });
});
