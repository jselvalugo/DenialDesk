import { afterEach, describe, expect, it } from "vitest";
import { DatabaseError } from "@/db/errors";
import { assertEnvironmentAllows, IntegrationConnectionError } from "@/domain/integrations/connections";
import { en } from "@/i18n/messages/en";
import { createTranslator } from "@/i18n/translate";
import { AzureKeyVaultKeyStore, EnvSharedKeyStore, SIGNING_KEY_ENV } from "@/integrations/fhir/keys";
import { SandboxNotPermittedError, SandboxTransport } from "@/integrations/fhir/sandbox/transport";
import { HttpsTransport } from "@/integrations/fhir/transport";
import { syntheticDataOnly } from "@/lib/env";
import { testConnectionFailure } from "./form-state";
import { connectionTestDeps } from "./test-deps";

const t = createTranslator(en.integrations, "en");
const ID = "3f0a5a5e-6f43-4d62-8f0a-000000000001";

describe("connectionTestDeps (Test connection wiring)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("a real connection gets the guarded HttpsTransport; the sandbox gets the in-process one (chosen from is_sandbox only)", () => {
    process.env.APP_ENV = "development";
    delete process.env.NETLIFY;
    const deps = connectionTestDeps();
    expect(deps.transportFor({ id: ID, isSandbox: false })).toBeInstanceOf(HttpsTransport);
    expect(deps.transportFor({ id: ID, isSandbox: true })).toBeInstanceOf(SandboxTransport);
  });

  it("APP_ENV=production on Netlify still only allows the sandbox: it is served in-process, and a real connection has no way around the environment rule", () => {
    process.env.APP_ENV = "production";
    process.env.NETLIFY = "true";
    expect(syntheticDataOnly()).toBe(true);
    expect(connectionTestDeps().transportFor({ id: ID, isSandbox: true })).toBeInstanceOf(SandboxTransport);
    // A real connection is refused by the environment rule (the same check Test connection and the
    // sync run apply before dialing), whatever APP_ENV says.
    expect(() => assertEnvironmentAllows(false, { syntheticOnly: syntheticDataOnly() })).toThrow(
      /real EHR|isn't allowed|can't connect/i,
    );
    expect(() => assertEnvironmentAllows(true, { syntheticOnly: syntheticDataOnly() })).not.toThrow();
  });

  it("where real data is allowed (production outside Netlify) the sandbox has no transport at all", () => {
    process.env.APP_ENV = "production";
    for (const name of ["NETLIFY", "NETLIFY_DB_URL", "DEPLOY_ID", "SITE_ID"]) delete process.env[name];
    expect(syntheticDataOnly()).toBe(false);
    expect(connectionTestDeps().transportFor({ id: ID, isSandbox: true })).toBeNull();
    expect(() => assertEnvironmentAllows(true, { syntheticOnly: syntheticDataOnly() })).toThrow();
    expect(() => new SandboxTransport({ publicKeys: async () => [] })).toThrow(SandboxNotPermittedError);
  });

  it("uses the shared env key store where only synthetic data is allowed", () => {
    process.env.APP_ENV = "preview";
    delete process.env.NETLIFY;
    expect(connectionTestDeps().keyStore()).toBeInstanceOf(EnvSharedKeyStore);
  });

  it("uses the fail-closed Key Vault stub in production outside Netlify", () => {
    process.env.APP_ENV = "production";
    for (const name of ["NETLIFY", "NETLIFY_DB_URL", "DEPLOY_ID", "SITE_ID", SIGNING_KEY_ENV])
      delete process.env[name];
    expect(connectionTestDeps().keyStore()).toBeInstanceOf(AzureKeyVaultKeyStore);
  });

  it("refuses to build a store in production when an env signing key is present", () => {
    process.env.APP_ENV = "production";
    for (const name of ["NETLIFY", "NETLIFY_DB_URL", "DEPLOY_ID", "SITE_ID"]) delete process.env[name];
    process.env[SIGNING_KEY_ENV] = "anything";
    expect(() => connectionTestDeps().keyStore()).toThrow(/refuse to start/);
  });
});

describe("testConnectionFailure", () => {
  it("keeps a domain refusal's translated message", () => {
    expect(testConnectionFailure(new IntegrationConnectionError("Nope"), t)).toEqual({ error: "Nope" });
  });

  it("turns a database error into one generic message, never its detail", () => {
    const state = testConnectionFailure(new DatabaseError("Failing row contains (secret)", "23514", "x"), t);
    expect(state).toEqual({ error: t("test.error.failed") });
    expect(JSON.stringify(state)).not.toContain("secret");
  });

  it("rethrows anything else (a bug, not a refusal)", () => {
    expect(() => testConnectionFailure(new TypeError("boom"), t)).toThrow("boom");
  });
});
