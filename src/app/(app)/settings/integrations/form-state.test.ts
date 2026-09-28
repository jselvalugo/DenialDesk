import { afterEach, describe, expect, it } from "vitest";
import { DatabaseError } from "@/db/errors";
import { IntegrationConnectionError } from "@/domain/integrations/connections";
import { en } from "@/i18n/messages/en";
import { createTranslator } from "@/i18n/translate";
import { connectionFormFailure, integrationActor } from "./form-state";

const t = createTranslator(en.integrations, "en");
const auth = { tenantId: "t-1", userId: "u-1", role: "admin" as const };

describe("integrationActor (PI1b-2)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("takes syntheticOnly from the server environment: every Netlify deploy is synthetic-only", () => {
    process.env.APP_ENV = "production";
    process.env.NETLIFY = "true";
    expect(integrationActor(auth).syntheticOnly).toBe(true);
  });

  it("is synthetic-only outside production", () => {
    process.env.APP_ENV = "preview";
    delete process.env.NETLIFY;
    expect(integrationActor(auth).syntheticOnly).toBe(true);
  });

  it("allows real endpoints only in production outside Netlify", () => {
    process.env.APP_ENV = "production";
    for (const key of ["NETLIFY", "NETLIFY_DB_URL", "DEPLOY_ID", "SITE_ID"]) delete process.env[key];
    expect(integrationActor(auth)).toEqual({ ...auth, syntheticOnly: false });
  });
});

describe("connectionFormFailure (PI1b-2)", () => {
  it("keeps a domain refusal's message and field", () => {
    expect(connectionFormFailure(new IntegrationConnectionError("Bad URL", "baseUrl"), t)).toEqual({
      error: "Bad URL",
      field: "baseUrl",
    });
  });

  it("turns a database error into one generic message, never its constraint detail", () => {
    const state = connectionFormFailure(
      new DatabaseError("Failing row contains (Main EHR, https://ehr.example.com)", "23514", "x_check"),
      t,
    );
    expect(state).toEqual({ error: t("error.saveFailed") });
    expect(JSON.stringify(state)).not.toContain("ehr.example.com");
  });

  it("rethrows anything else (a bug, not a refusal)", () => {
    expect(() => connectionFormFailure(new TypeError("boom"), t)).toThrow("boom");
  });
});
