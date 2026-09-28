import { describe, expect, it } from "vitest";
import { buildLogRecord } from "./log";

const CLAIM_ID = "3f2a0c1e-8d4b-4c6a-9e7f-0a1b2c3d4e5f";
const TENANT_ID = "00000000-0000-4000-8000-000000000001";

describe("buildLogRecord", () => {
  it("accepts IDs and allowed metric fields", () => {
    const record = buildLogRecord("info", "claim.submitted", {
      claimId: CLAIM_ID,
      tenantId: TENANT_ID,
      durationMs: 12,
    });
    expect(record).toMatchObject({
      level: "info",
      event: "claim.submitted",
      claimId: CLAIM_ID,
      durationMs: 12,
    });
  });

  it("drops an …Id field whose value isn't UUID-shaped, instead of logging it (patient integrations I1)", () => {
    const record = buildLogRecord("info", "claim.submitted", { claimId: "c_1", tenantId: TENANT_ID });
    expect(record).not.toHaveProperty("claimId");
    expect(record).toMatchObject({ tenantId: TENANT_ID });
  });

  it("refuses external_id/member/client/source-version ID-shaped keys outright, UUID or not", () => {
    for (const key of ["externalId", "memberId", "clientId", "sourceVersionId"]) {
      expect(() => buildLogRecord("info", "integration.sync_completed", { [key]: CLAIM_ID })).toThrow(
        new RegExp(key),
      );
    }
  });

  it("rejects fields that are not IDs", () => {
    expect(() => buildLogRecord("info", "claim.submitted", { patientName: "Synthetic Person" })).toThrow(
      /patientName/,
    );
    expect(() => buildLogRecord("info", "claim.submitted", { memberId2: "x" })).toThrow(/memberId2/);
  });

  it("rejects free-form event names", () => {
    expect(() => buildLogRecord("error", "Failed for claim 123")).toThrow(/area\.action/);
  });

  it("doesn't treat inherited object keys as allowed fields", () => {
    expect(() => buildLogRecord("info", "claim.submitted", { constructor: "x" })).toThrow(/constructor/);
  });

  it("rejects code-defined fields whose values don't match their pattern", () => {
    expect(() =>
      buildLogRecord("error", "request.unhandled_error", { route: "/patients?mrn=SYN-1" }),
    ).toThrow(/route/);
    expect(() => buildLogRecord("warn", "db.query_failed", { constraint: "idx (Synthetic Person)" })).toThrow(
      /constraint/,
    );
    expect(
      buildLogRecord("error", "request.unhandled_error", { route: "/patients/[id]", digest: "42" }),
    ).toMatchObject({ route: "/patients/[id]", digest: "42" });
  });
});
