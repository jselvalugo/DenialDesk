import { generateKeyPairSync } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/.well-known/jwks.json/route";
import { closeDatabase } from "@/db/client";
import { SIGNING_KEY_ENV } from "@/integrations/fhir/keys";

// docs/specs/patient-integrations.md PI2a "JWKS routes": the pre-production shared key, through the
// real route handler and the real `jwks` rate-limit bucket (PostgreSQL). No database read of its own.

const saved = { ...process.env };

beforeEach(() => {
  process.env.APP_ENV = "preview";
  for (const name of ["NETLIFY", "NETLIFY_DB_URL", "DEPLOY_ID", "SITE_ID", SIGNING_KEY_ENV]) {
    delete process.env[name];
  }
});
afterEach(() => {
  process.env = { ...saved };
});
afterAll(() => closeDatabase());

describe("GET /.well-known/jwks.json", () => {
  it("serves the public key of INTEGRATION_SIGNING_KEY, and only public fields", async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
    process.env[SIGNING_KEY_ENV] = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    const text = await response.text();
    const body = JSON.parse(text) as { keys: Record<string, string>[] };
    expect(Object.keys(body.keys[0]!).sort()).toEqual(["alg", "crv", "kid", "kty", "use", "x", "y"]);
    expect(text).not.toMatch(/"(d|p|q|dp|dq|qi)"/);
  });

  it("is 404 when the key isn't configured", async () => {
    expect((await GET()).status).toBe(404);
  });

  it("is 404 in production outside Netlify even when an env key is (wrongly) set", async () => {
    process.env.APP_ENV = "production";
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "secp384r1" });
    process.env[SIGNING_KEY_ENV] = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    expect((await GET()).status).toBe(404);
  });
});
