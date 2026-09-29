import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/db/errors";
import { en } from "@/i18n/messages/en";
import { es } from "@/i18n/messages/es";
import { pt } from "@/i18n/messages/pt";
import {
  assertEnvironmentAllows,
  attestationTextSha256,
  environmentRefusalKey,
  IntegrationConnectionError,
  requireStepUp,
  submitConnection,
  US_RESIDENCY_ATTESTATION_VERSION,
} from "./connections";
import { isRevokeReasonCode, REVOKE_REASON_CODES, REVOKE_REASON_LABEL_KEYS } from "./revoke-reasons";

// Pure parts of the PI2a lifecycle (docs/specs/patient-integrations.md); the transitions themselves
// run against the database in test/integration/integration-lifecycle.test.ts.

// Submit spends the practice's rate limit before it opens a transaction; the limiter is a database
// table, so these unit tests replace it (the real one is exercised in test/integration).
vi.mock("@/lib/rate-limit", () => ({ hit: async () => ({ allowed: true, retryAfterSeconds: 0 }) }));

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

describe("Submit's fixed wording (spec PI2a)", () => {
  // The attestation and the registry refusal are quoted from the spec. Changing the attestation's
  // English text changes what an administrator agreed to: bump US_RESIDENCY_ATTESTATION_VERSION with it.
  it("pins the residency attestation text to its recorded version", () => {
    expect(US_RESIDENCY_ATTESTATION_VERSION).toBe(1);
    expect(en.integrations["submit.attestation"]).toBe(
      "This EHR/PM endpoint stores and processes data only in the United States",
    );
    // The translations are what a Spanish- or Portuguese-reading administrator agrees to. They are
    // pending native-speaker and counsel review (OA-041); pinning them means any edit is deliberate
    // and comes with a version bump, not a silent change to what was attested.
    expect(es.integrations["submit.attestation"]).toBe(
      "Este punto de conexión de EHR/PM almacena y procesa los datos únicamente en Estados Unidos",
    );
    expect(pt.integrations["submit.attestation"]).toBe(
      "Este endpoint de EHR/PM armazena e processa dados somente nos Estados Unidos",
    );
  });

  it("hashes the exact text shown in each language (recorded as attestation_text_sha256)", () => {
    const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
    expect(attestationTextSha256("en")).toBe(sha256(en.integrations["submit.attestation"]));
    expect(attestationTextSha256("es")).toBe(sha256(es.integrations["submit.attestation"]));
    expect(attestationTextSha256("pt")).toBe(sha256(pt.integrations["submit.attestation"]));
    // Three languages, three different texts, three different digests.
    expect(attestationTextSha256("en")).toMatch(/^[0-9a-f]{64}$/);
    expect(
      new Set([attestationTextSha256("en"), attestationTextSha256("es"), attestationTextSha256("pt")]).size,
    ).toBe(3);
  });

  it("refuses a registry conflict in the spec's words, naming no other practice", () => {
    expect(en.integrations["error.registryConflict"]).toBe(
      "This endpoint and client ID are already connected",
    );
  });

  it("has the attestation, the refusals, and the awaiting-approval notice in every language", () => {
    for (const key of [
      "submit.attestation",
      "submit.awaitingTitle",
      "submit.awaitingDescription",
      "submit.blocked.noPassingTest",
      "error.testRequired",
      "error.testRequiredToResume",
      "error.attestationRequired",
      "error.registryConflict",
    ] as const) {
      expect(es.integrations[key], key).toBeTruthy();
      expect(pt.integrations[key], key).toBeTruthy();
    }
    expect(en.integrations["submit.awaitingTitle"]).toBe("Awaiting DenialDesk approval");
  });
});

describe("submitConnection before any transaction", () => {
  it.each(["manager", "specialist", "compliance"] as const)(
    "refuses a %s without opening a transaction",
    async (role) => {
      const run = () => Promise.reject(new Error("a transaction was opened"));
      await expect(
        submitConnection(
          run,
          { ...actor, role, recentMfa: true },
          "00000000-0000-4000-8000-000000000000",
          "2026-01-01T00:00:00.000Z",
          { attested: true, locale: "en" },
          { keyStore: () => Promise.reject(new Error("the key store was used")) as never },
        ),
      ).rejects.toThrow(/Only an administrator/);
    },
  );

  it("refuses a language the app doesn't have, naming the change", async () => {
    const run = () => Promise.reject(new Error("a transaction was opened"));
    await expect(
      submitConnection(
        run,
        { ...actor, recentMfa: true },
        "00000000-0000-4000-8000-000000000000",
        "2026-01-01T00:00:00.000Z",
        { attested: true, locale: "fr" as never },
        { keyStore: () => Promise.reject(new Error("the key store was used")) as never },
      ),
    ).rejects.toThrow(/page language changed/);
  });
});

describe("environmentRefusalKey (the Submit panel and assertEnvironmentAllows share it)", () => {
  it("is the message assertEnvironmentAllows refuses with, or null", () => {
    expect(environmentRefusalKey(false, { syntheticOnly: false })).toBeNull();
    expect(environmentRefusalKey(true, { syntheticOnly: true })).toBeNull();
    expect(environmentRefusalKey(false, { syntheticOnly: true })).toBe("error.realEndpointRefused");
    expect(environmentRefusalKey(true, { syntheticOnly: false })).toBe("error.sandboxRefused");
    expect(() => assertEnvironmentAllows(false, { syntheticOnly: true })).toThrow(
      en.integrations["error.realEndpointRefused"],
    );
  });

  it("has the new refusals in every language", () => {
    for (const key of [
      "error.anotherConnectionLive",
      "error.localeChanged",
      "error.attestationChanged",
      "error.submitRateLimited",
    ] as const) {
      expect(en.integrations[key], key).toBeTruthy();
      expect(es.integrations[key], key).toBeTruthy();
      expect(pt.integrations[key], key).toBeTruthy();
    }
  });

  it("words the one-connection refusal so it covers paused and error connections too", () => {
    // Any status but draft/revoked counts against the practice's one connection (the unique index).
    expect(en.integrations["error.anotherConnectionLive"]).toBe(
      "Another connection is already in use (submitted, active, paused, or in error). Withdraw or revoke it first.",
    );
    expect(es.integrations["error.anotherConnectionLive"]).toMatch(/en pausa/);
    expect(pt.integrations["error.anotherConnectionLive"]).toMatch(/pausada/);
  });
});

describe("submitConnection's mapping of a unique violation (spec PI2a: two drafts racing)", () => {
  // Two drafts of one practice leaving `draft` at the same moment: the loser hits the partial unique
  // index integration_connections_one_active, and reads the same refusal as the check in front of it.
  const submitWith = (run: () => Promise<never>) =>
    submitConnection(
      run,
      { ...actor, recentMfa: true },
      "00000000-0000-4000-8000-000000000000",
      "2026-01-01T00:00:00.000Z",
      { attested: true, locale: "en" },
      { keyStore: () => ({ kid: async () => "kid-1" }) as never },
    );

  it("maps a 23505 on integration_connections_one_active to error.anotherConnectionLive", async () => {
    const violation = new DatabaseError(
      "duplicate key value violates unique constraint",
      "23505",
      "integration_connections_one_active",
    );
    const error = await submitWith(() => Promise.reject(violation)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IntegrationConnectionError);
    expect(error).not.toBe(violation);
    expect((error as IntegrationConnectionError).message).toBe(
      en.integrations["error.anotherConnectionLive"],
    );
    // A refusal in words: no field, and no step-up to offer.
    expect((error as IntegrationConnectionError).field).toBeUndefined();
    expect((error as IntegrationConnectionError).stepUpRequired).toBe(false);
  });

  it.each([
    [
      "another constraint name",
      new DatabaseError("unique", "23505", "integration_connections_tenant_id_key"),
    ],
    ["no constraint name", new DatabaseError("unique", "23505")],
    [
      "the right constraint name under another SQLSTATE",
      new DatabaseError("check", "23514", "integration_connections_one_active"),
    ],
    ["a plain error", new Error("boom")],
  ])("rethrows %s unchanged", async (_label, failure) => {
    await expect(submitWith(() => Promise.reject(failure))).rejects.toBe(failure);
  });
});
