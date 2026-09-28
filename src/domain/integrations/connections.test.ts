import { describe, expect, it } from "vitest";
import { SANDBOX_BASE_URL, SANDBOX_CLIENT_ID } from "@/integrations/fhir/url-rules";
import {
  assertEnvironmentAllows,
  blocksPatientsRegister,
  ConnectionError,
  connectionInputSchema,
  isSandboxRequest,
  parseConnectionInput,
  type PatientsConnectionSummary,
} from "./connections";

const validInput = {
  displayName: "Acme EHR",
  baseUrl: "https://ehr.example.com/r4",
  clientId: "client-123",
  mrnIdentifierSystem: "http://hospital.example.org/mrn",
  usResidencyAttested: true,
};

describe("connectionInputSchema (strict allow-list)", () => {
  it("accepts exactly the five allowed fields", () => {
    expect(connectionInputSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects an extra field such as status", () => {
    const result = connectionInputSchema.safeParse({ ...validInput, status: "active" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing required field", () => {
    const rest: Partial<typeof validInput> = { ...validInput };
    delete rest.displayName;
    expect(connectionInputSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a display name over 80 characters", () => {
    const result = connectionInputSchema.safeParse({ ...validInput, displayName: "x".repeat(81) });
    expect(result.success).toBe(false);
  });
});

describe("parseConnectionInput", () => {
  it("maps a ZodError to a field message key, never the raw zod message", () => {
    const result = parseConnectionInput({ ...validInput, displayName: "" });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.field).toBe("displayName");
      expect(result.error.message).not.toMatch(/zod|string|expected/i);
    }
  });

  it("passes through valid input", () => {
    const result = parseConnectionInput(validInput);
    expect("data" in result).toBe(true);
  });
});

describe("isSandboxRequest", () => {
  it("recognizes the pinned sandbox base URL and client ID", () => {
    expect(isSandboxRequest({ baseUrl: SANDBOX_BASE_URL, clientId: SANDBOX_CLIENT_ID })).toBe(true);
  });

  it("treats anything else as a real endpoint", () => {
    expect(isSandboxRequest({ baseUrl: "https://ehr.example.com/r4", clientId: "client-1" })).toBe(false);
    expect(isSandboxRequest({ baseUrl: SANDBOX_BASE_URL, clientId: "client-1" })).toBe(false);
    expect(isSandboxRequest({ baseUrl: "https://ehr.example.com/r4", clientId: SANDBOX_CLIENT_ID })).toBe(
      false,
    );
  });
});

describe("assertEnvironmentAllows (environment gating matrix)", () => {
  it("allows the sandbox only in a synthetic-data environment", () => {
    expect(() => assertEnvironmentAllows(true, { syntheticOnly: true })).not.toThrow();
    expect(() => assertEnvironmentAllows(true, { syntheticOnly: false })).toThrow(ConnectionError);
  });

  it("allows a real endpoint only outside a synthetic-data environment", () => {
    expect(() => assertEnvironmentAllows(false, { syntheticOnly: false })).not.toThrow();
    expect(() => assertEnvironmentAllows(false, { syntheticOnly: true })).toThrow(ConnectionError);
  });
});

describe("blocksPatientsRegister", () => {
  const summary = (status: PatientsConnectionSummary["status"]): PatientsConnectionSummary => ({
    id: "c1",
    displayName: "Acme EHR",
    status,
    isSandbox: false,
    lastSuccessAt: null,
    hasSynced: false,
  });

  it("is open with no connection, a draft, or a revoked connection", () => {
    expect(blocksPatientsRegister(null)).toBe(false);
    expect(blocksPatientsRegister(summary("draft"))).toBe(false);
    expect(blocksPatientsRegister(summary("revoked"))).toBe(false);
  });

  it("blocks for every other status", () => {
    expect(blocksPatientsRegister(summary("pending_approval"))).toBe(true);
    expect(blocksPatientsRegister(summary("active"))).toBe(true);
    expect(blocksPatientsRegister(summary("paused"))).toBe(true);
    expect(blocksPatientsRegister(summary("error"))).toBe(true);
  });
});
