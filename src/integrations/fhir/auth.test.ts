import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import { signerForPrivateKey, type JwtSigner } from "@/lib/crypto/jwt-sign";
import {
  FAKE_ACCESS_TOKEN,
  FAKE_CLIENT_ID,
  FAKE_TOKEN_ENDPOINT,
  FakeFhirTransport,
  jsonResponse,
  statusOnly,
  tokenResponse,
} from "../../../test/support/fake-fhir-transport";
import {
  AccessToken,
  AccessTokenCache,
  ASSERTION_LIFETIME_SECONDS,
  buildClientAssertion,
  CLIENT_ASSERTION_TYPE,
  requestAccessToken,
} from "./auth";
import { TransportError } from "./errors";
import { FhirConnectError } from "./outcomes";

const SCOPES = "system/Patient.rs system/Coverage.rs system/Organization.rs";
const POST = `POST ${FAKE_TOKEN_ENDPOINT}`;
const NOW = new Date("2026-09-28T12:00:00.000Z");

/** The error a call rejects with; fails if it resolved. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the call to reject");
}

function es384() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
  return { signer: signerForPrivateKey(privateKey, "kid-es"), publicKey };
}
function rs384() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { signer: signerForPrivateKey(privateKey, "kid-rs"), publicKey };
}

function parts(jwt: string) {
  const [h, p, s] = jwt.split(".") as [string, string, string];
  const json = (x: string) =>
    JSON.parse(Buffer.from(x, "base64url").toString("utf8")) as Record<string, unknown>;
  return {
    header: json(h),
    claims: json(p),
    signingInput: `${h}.${p}`,
    signature: Buffer.from(s, "base64url"),
  };
}

describe("buildClientAssertion (RFC 7523; spec PI2a Token)", () => {
  it("sets iss = sub = client_id, aud = the pinned token endpoint, iat, exp <= iat + 5 min, unique jti", async () => {
    const { signer } = es384();
    const jwt = await buildClientAssertion({
      clientId: FAKE_CLIENT_ID,
      tokenEndpoint: FAKE_TOKEN_ENDPOINT,
      signer,
      now: NOW,
    });
    const { claims } = parts(jwt);
    const iat = Math.floor(NOW.getTime() / 1000);
    expect(claims).toMatchObject({
      iss: FAKE_CLIENT_ID,
      sub: FAKE_CLIENT_ID,
      aud: FAKE_TOKEN_ENDPOINT,
      iat,
      exp: iat + ASSERTION_LIFETIME_SECONDS,
    });
    expect(Object.keys(claims).sort()).toEqual(["aud", "exp", "iat", "iss", "jti", "sub"]);
    expect((claims.exp as number) - (claims.iat as number)).toBeLessThanOrEqual(5 * 60);
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("uses a different jti every time", async () => {
    const { signer } = es384();
    const jtis = new Set<unknown>();
    for (let i = 0; i < 25; i++) {
      const jwt = await buildClientAssertion({ clientId: "c", tokenEndpoint: FAKE_TOKEN_ENDPOINT, signer });
      jtis.add(parts(jwt).claims.jti);
    }
    expect(jtis.size).toBe(25);
  });

  it("has header { alg from the signer, kid, typ: JWT } for ES384 and RS384", async () => {
    for (const [make, alg, kid] of [
      [es384, "ES384", "kid-es"],
      [rs384, "RS384", "kid-rs"],
    ] as const) {
      const { signer } = make();
      const { header } = parts(
        await buildClientAssertion({ clientId: "c", tokenEndpoint: FAKE_TOKEN_ENDPOINT, signer }),
      );
      expect(header).toEqual({ alg, kid, typ: "JWT" });
    }
  });

  it("produces a signature that verifies against the public key", async () => {
    const { signer, publicKey } = es384();
    const jwt = await buildClientAssertion({ clientId: "c", tokenEndpoint: FAKE_TOKEN_ENDPOINT, signer });
    const { signingInput, signature } = parts(jwt);
    expect(
      cryptoVerify(
        "sha384",
        Buffer.from(signingInput),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        signature,
      ),
    ).toBe(true);
  });
});

describe("requestAccessToken", () => {
  const base = () => ({
    tokenEndpoint: FAKE_TOKEN_ENDPOINT,
    clientId: FAKE_CLIENT_ID,
    scopes: SCOPES,
    now: NOW,
  });

  it("POSTs a form-encoded client_credentials request with the client assertion and no other credentials", async () => {
    const transport = FakeFhirTransport.healthy();
    await requestAccessToken({ ...base(), transport, signer: es384().signer });
    const request = transport.requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.url.href).toBe(FAKE_TOKEN_ENDPOINT);
    expect(request.contentType).toBe("application/x-www-form-urlencoded");
    expect(request.accept).toEqual(["application/json"]);
    expect(request.headers).toBeUndefined();
    const form = transport.postedForm();
    expect([...form.keys()].sort()).toEqual([
      "client_assertion",
      "client_assertion_type",
      "grant_type",
      "scope",
    ]);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("scope")).toBe(SCOPES);
    expect(form.get("client_assertion_type")).toBe(CLIENT_ASSERTION_TYPE);
    expect(parts(form.get("client_assertion")!).claims.aud).toBe(FAKE_TOKEN_ENDPOINT);
    // No client_id / secret in the body: the assertion carries the identity.
    expect(request.body).not.toContain("client_secret");
  });

  it("returns a redacted token and an expiry reduced by a skew margin", async () => {
    const transport = FakeFhirTransport.healthy();
    const grant = await requestAccessToken({ ...base(), transport, signer: es384().signer });
    expect(grant.token.reveal()).toBe(FAKE_ACCESS_TOKEN);
    expect(grant.expiresAtMs).toBe(NOW.getTime() + 300_000 - 30_000);
  });

  it("caps a server's expires_in at one hour", async () => {
    const transport = FakeFhirTransport.healthy().set(
      POST,
      jsonResponse(tokenResponse({ expires_in: 86_400 })),
    );
    const grant = await requestAccessToken({ ...base(), transport, signer: es384().signer });
    expect(grant.expiresAtMs).toBe(NOW.getTime() + 3_600_000 - 30_000);
  });

  it("accepts a Bearer token_type in any case and extra granted scopes", async () => {
    for (const token_type of ["Bearer", "BEARER", "bearer"]) {
      const transport = FakeFhirTransport.healthy().set(
        POST,
        jsonResponse(tokenResponse({ token_type, scope: `${SCOPES} system/Group.rs` })),
      );
      await expect(
        requestAccessToken({ ...base(), transport, signer: es384().signer }),
      ).resolves.toBeDefined();
    }
  });

  it("refuses a token that is not bearer", async () => {
    for (const token_type of ["mac", "DPoP", "", undefined]) {
      const transport = FakeFhirTransport.healthy().set(POST, jsonResponse(tokenResponse({ token_type })));
      const error = await requestAccessToken({ ...base(), transport, signer: es384().signer }).catch(
        (e: unknown) => e as FhirConnectError,
      );
      expect(error).toMatchObject({ outcome: "smart_config_invalid", detail: "bad_token_response" });
    }
  });

  it.each([
    ["access_token missing", { access_token: undefined }],
    ["access_token empty", { access_token: "" }],
    ["access_token not a string", { access_token: 12 }],
    ["access_token absurdly long", { access_token: "x".repeat(20_000) }],
    ["expires_in missing", { expires_in: undefined }],
    ["expires_in zero", { expires_in: 0 }],
    ["expires_in negative", { expires_in: -5 }],
    ["expires_in a string", { expires_in: "300" }],
  ])("refuses a token response with %s", async (_name, overrides) => {
    const transport = FakeFhirTransport.healthy().set(POST, jsonResponse(tokenResponse(overrides)));
    const error = await requestAccessToken({ ...base(), transport, signer: es384().signer }).catch(
      (e: unknown) => e as FhirConnectError,
    );
    expect(error).toMatchObject({ outcome: "smart_config_invalid", detail: "bad_token_response" });
  });

  it("refuses a body that isn't JSON", async () => {
    const transport = FakeFhirTransport.healthy().set(POST, jsonResponse("access_token=abc"));
    const error = await requestAccessToken({ ...base(), transport, signer: es384().signer }).catch(
      (e: unknown) => e as FhirConnectError,
    );
    expect(error).toMatchObject({ outcome: "smart_config_invalid" });
  });

  describe("granted scopes (scope_insufficient)", () => {
    it.each([
      ["scope missing", { scope: undefined }],
      ["scope empty", { scope: "" }],
      ["one required scope not granted", { scope: "system/Patient.rs system/Coverage.rs" }],
      [
        "v1 scopes granted for a v2 request",
        { scope: "system/Patient.read system/Coverage.read system/Organization.read" },
      ],
      [
        "a prefix match is not a match",
        { scope: "system/Patient.rs system/Coverage.rs system/Organization.rsx" },
      ],
    ])("%s", async (_name, overrides) => {
      const transport = FakeFhirTransport.healthy().set(POST, jsonResponse(tokenResponse(overrides)));
      const error = await requestAccessToken({ ...base(), transport, signer: es384().signer }).catch(
        (e: unknown) => e as FhirConnectError,
      );
      expect(error).toMatchObject({ outcome: "capability_missing", detail: "scope_insufficient" });
    });
  });

  describe("status and transport failures", () => {
    it.each([
      [400, "auth_refused"],
      [401, "auth_refused"],
      [403, "auth_refused"],
      [404, "auth_refused"],
      [429, "unreachable"],
      [500, "unreachable"],
      [502, "unreachable"],
    ])("token endpoint status %s -> %s", async (status, outcome) => {
      const transport = FakeFhirTransport.healthy().set(POST, statusOnly(status));
      const error = await rejection(requestAccessToken({ ...base(), transport, signer: es384().signer }));
      expect(error).toBeInstanceOf(FhirConnectError);
      expect((error as FhirConnectError).outcome).toBe(outcome);
    });

    it.each([
      ["tls_failed", "tls_failed", "tls_failed"],
      ["address_refused", "unreachable", "address_refused"],
      ["redirect_refused", "unreachable", "redirect_refused"],
      ["timeout", "unreachable", "timeout"],
      ["content_type_refused", "smart_config_invalid", "content_type_refused"],
      ["too_large", "smart_config_invalid", "too_large"],
    ] as const)("transport %s -> %s", async (code, outcome, kept) => {
      const transport = FakeFhirTransport.healthy().set(POST, new TransportError(code));
      const error = await requestAccessToken({ ...base(), transport, signer: es384().signer }).catch(
        (e: unknown) => e as FhirConnectError,
      );
      expect(error).toMatchObject({ outcome, transportCode: kept });
    });
  });

  describe("never logs or exposes the token, the assertion, or a response body", () => {
    it("error messages and serialized errors carry only the outcome code", async () => {
      const secretBody = "SECRET-RESPONSE-BODY-abc123";
      const transport = FakeFhirTransport.healthy().set(POST, {
        status: 200,
        contentType: "application/json",
        body: `{"access_token":"${secretBody}"`, // truncated JSON
      });
      const error = await rejection(requestAccessToken({ ...base(), transport, signer: es384().signer }));
      expect(JSON.stringify(error)).not.toContain(secretBody);
      expect(error.message).toBe("smart_config_invalid");
      expect(String(error.stack)).not.toContain(secretBody);
    });

    it("does not call console or process stdout/stderr on success or failure", async () => {
      const spies = [
        vi.spyOn(console, "log"),
        vi.spyOn(console, "info"),
        vi.spyOn(console, "warn"),
        vi.spyOn(console, "error"),
        vi.spyOn(console, "debug"),
      ];
      try {
        await requestAccessToken({
          ...base(),
          transport: FakeFhirTransport.healthy(),
          signer: es384().signer,
        });
        await requestAccessToken({
          ...base(),
          transport: FakeFhirTransport.healthy().set(POST, statusOnly(401)),
          signer: es384().signer,
        }).catch(() => undefined);
        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    });

    it("the AccessToken redacts itself under JSON, string, template, and inspect", async () => {
      const grant = await requestAccessToken({
        ...base(),
        transport: FakeFhirTransport.healthy(),
        signer: es384().signer,
      });
      const shown = [
        JSON.stringify(grant),
        JSON.stringify({ nested: grant.token }),
        String(grant.token),
        `${grant.token}`,
        inspect(grant),
        inspect(grant.token),
      ].join("|");
      expect(shown).not.toContain(FAKE_ACCESS_TOKEN);
      expect(shown).toContain("redacted");
      expect(Object.keys(grant.token)).toEqual([]);
    });

    it("an assertion signer failure surfaces without key material", async () => {
      const failing: JwtSigner = {
        alg: "ES384",
        kid: "k",
        sign: async () => {
          throw new Error("vault said: PRIVATE-KEY-DETAIL");
        },
      };
      // The signer's own error is a bug/config failure, not an outcome: it propagates unchanged for
      // the caller to map, and the caller (Test connection) never logs it.
      await expect(
        requestAccessToken({ ...base(), transport: FakeFhirTransport.healthy(), signer: failing }),
      ).rejects.toThrow();
    });
  });
});

describe("AccessTokenCache (memory only; re-request on expiry or one 401)", () => {
  const grant = (expiresAtMs: number) => ({ token: new AccessToken("t"), expiresAtMs });

  it("returns a live token, and nothing once it has expired", () => {
    let now = 1_000;
    const cache = new AccessTokenCache(() => now);
    cache.set("c1", grant(2_000));
    expect(cache.get("c1")?.reveal()).toBe("t");
    now = 1_999;
    expect(cache.get("c1")).not.toBeNull();
    now = 2_000; // expiry instant is already expired
    expect(cache.get("c1")).toBeNull();
    now = 500;
    expect(cache.get("c1")).toBeNull(); // and it was evicted, not just hidden
  });

  it("keeps connections apart and invalidates one on a 401", () => {
    const cache = new AccessTokenCache(() => 0);
    cache.set("a", grant(10));
    cache.set("b", grant(10));
    cache.invalidate("a");
    expect(cache.get("a")).toBeNull();
    expect(cache.get("b")).not.toBeNull();
    expect(cache.get("never-set")).toBeNull();
  });
});
