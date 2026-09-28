import { describe, expect, it } from "vitest";
import { en } from "@/i18n/messages/en";
import { es } from "@/i18n/messages/es";
import { pt } from "@/i18n/messages/pt";
import { assertEnvironmentAllows, IntegrationConnectionError, requireStepUp } from "./connections";
import { isRevokeReasonCode, REVOKE_REASON_CODES, REVOKE_REASON_LABEL_KEYS } from "./revoke-reasons";

// Pure parts of the PI2a lifecycle (docs/specs/patient-integrations.md); the transitions themselves
// run against the database in test/integration/integration-lifecycle.test.ts.

const actor = { tenantId: "t", userId: "u", role: "admin" as const, syntheticOnly: false };

describe("requireStepUp (R-7.2.2)", () => {
  it("passes for a recent MFA verification", () => {
    expect(() => requireStepUp({ ...actor, recentMfa: true })).not.toThrow();
  });

  it.each([{ recentMfa: false }, {}])("refuses %j, flagged so the page can link to /step-up", (extra) => {
    let caught: unknown;
    try {
      requireStepUp({ ...actor, ...extra });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IntegrationConnectionError);
    expect((caught as IntegrationConnectionError).stepUpRequired).toBe(true);
    expect((caught as IntegrationConnectionError).message).toMatch(/two-step verification/);
  });
});

describe("assertEnvironmentAllows (spec: environment and population rules)", () => {
  it("allows the sandbox where only synthetic data is allowed, and a real endpoint elsewhere", () => {
    expect(() => assertEnvironmentAllows(true, { syntheticOnly: true })).not.toThrow();
    expect(() => assertEnvironmentAllows(false, { syntheticOnly: false })).not.toThrow();
  });

  it("refuses a real endpoint where only synthetic data is allowed", () => {
    expect(() => assertEnvironmentAllows(false, { syntheticOnly: true })).toThrow(/synthetic data only/);
  });

  it("refuses the sandbox in production", () => {
    expect(() => assertEnvironmentAllows(true, { syntheticOnly: false })).toThrow(
      /isn't available in production/,
    );
  });
});

describe("revoke reason codes", () => {
  it("are a fixed vocabulary that fits the status_reason CHECK (^[a-z_]{1,64}$)", () => {
    for (const code of REVOKE_REASON_CODES) {
      expect(code).toMatch(/^[a-z_]{1,64}$/);
      expect(isRevokeReasonCode(code)).toBe(true);
    }
  });

  it.each(["", "NO_LONGER_USED", "no_longer_used ", "free text with patient info", null, undefined, 3])(
    "refuses %j",
    (value) => {
      expect(isRevokeReasonCode(value)).toBe(false);
    },
  );

  it("have a label in English, Spanish, and Portuguese", () => {
    for (const code of REVOKE_REASON_CODES) {
      const key = REVOKE_REASON_LABEL_KEYS[code];
      expect(en.integrations[key]).toBeTruthy();
      expect(es.integrations[key]).toBeTruthy();
      expect(pt.integrations[key]).toBeTruthy();
    }
  });
});
