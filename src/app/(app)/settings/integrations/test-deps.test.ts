import { afterEach, describe, expect, it } from "vitest";
import { DatabaseError } from "@/db/errors";
import { IntegrationConnectionError } from "@/domain/integrations/connections";
import { en } from "@/i18n/messages/en";
import { createTranslator } from "@/i18n/translate";
import { AzureKeyVaultKeyStore, EnvSharedKeyStore, SIGNING_KEY_ENV } from "@/integrations/fhir/keys";
import { HttpsTransport } from "@/integrations/fhir/transport";
import { testConnectionFailure } from "./form-state";
import { connectionTestDeps } from "./test-deps";

const t = createTranslator(en.integrations, "en");

describe("connectionTestDeps (Test connection wiring)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("a real connection gets the guarded HttpsTransport; the sandbox gets none (chosen from is_sandbox only)", () => {
    const deps = connectionTestDeps();
    expect(deps.transportFor({ isSandbox: false })).toBeInstanceOf(HttpsTransport);
    expect(deps.transportFor({ isSandbox: true })).toBeNull();
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
