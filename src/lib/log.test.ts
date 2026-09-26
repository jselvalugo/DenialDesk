import { describe, expect, it } from "vitest";
import { buildLogRecord } from "./log";

describe("buildLogRecord", () => {
  it("accepts IDs and allowed metric fields", () => {
    const record = buildLogRecord("info", "claim.submitted", {
      claimId: "c_1",
      tenantId: "t_1",
      durationMs: 12,
    });
    expect(record).toMatchObject({ level: "info", event: "claim.submitted", claimId: "c_1", durationMs: 12 });
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
});
