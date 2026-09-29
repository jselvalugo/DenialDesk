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
    expect(integrationActor(auth)).toEqual({
      ...auth,
      syntheticOnly: false,
      recentMfa: false,
      stepUpVerifiedAt: null,
      sessionId: null,
    });
  });

  it("carries the session row's ID for the audit events that record it", () => {
    const sessionId = "6b1f4e0a-7c1e-4d52-9d0e-3f7a1a2b3c4d";
    expect(integrationActor({ ...auth, sessionId }).sessionId).toBe(sessionId);
  });
});

describe("integrationActor's step-up flag (R-7.2.2)", () => {
  const verifiedAt = new Date("2026-09-28T12:00:00.000Z");
  const at = (seconds: number) => new Date(verifiedAt.getTime() + seconds * 1000);
  const actorAt = (seconds: number) =>
    integrationActor({ ...auth, mfaVerifiedAt: verifiedAt }, () => false, at(seconds));

  it("is recent at 4:59 and 5:00 after the last verification, and not at 5:01", () => {
    expect(actorAt(4 * 60 + 59).recentMfa).toBe(true);
    expect(actorAt(5 * 60).recentMfa).toBe(true);
    expect(actorAt(5 * 60 + 1).recentMfa).toBe(false);
  });

  it("is never recent without a recorded verification (a session from before migration 0041)", () => {
    expect(integrationActor(auth).recentMfa).toBe(false);
    expect(integrationActor({ ...auth, mfaVerifiedAt: null }).recentMfa).toBe(false);
  });
});

describe("connectionFormFailure (PI1b-2)", () => {
  it("keeps a domain refusal's message and field", () => {
    expect(connectionFormFailure(new IntegrationConnectionError("Bad URL", "baseUrl"), t)).toEqual({
      error: "Bad URL",
      field: "baseUrl",
    });
  });

  it("marks the refusal a fresh MFA verification fixes, so the page can offer the step-up link", () => {
    expect(connectionFormFailure(new IntegrationConnectionError("Verify first", undefined, true), t)).toEqual(
      {
        error: "Verify first",
        field: undefined,
        stepUpRequired: true,
      },
    );
    expect(connectionFormFailure(new IntegrationConnectionError("Bad URL", "baseUrl"), t)).not.toHaveProperty(
      "stepUpRequired",
    );
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
