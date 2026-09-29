import { describe, expect, it } from "vitest";
import { isOlderCopy } from "./sync-upsert";

// docs/specs/patient-integrations.md PI2b, threat model T4 "no regression": an older copy of a record never
// overwrites a newer one, judged by meta.lastUpdated and, when that is missing or equal, by a numeric versionId.

const at = (iso: string) => new Date(iso);
const stamp = (lastUpdated: string | null, versionId: string | null) => ({
  sourceLastUpdated: lastUpdated ? at(lastUpdated) : null,
  sourceVersionId: versionId,
});

describe("isOlderCopy", () => {
  it("lastUpdated decides when both sides have one and they differ", () => {
    expect(isOlderCopy(stamp("2026-09-02T00:00:00Z", "9"), stamp("2026-09-01T00:00:00Z", "10"))).toBe(true);
    expect(isOlderCopy(stamp("2026-09-01T00:00:00Z", "9"), stamp("2026-09-02T00:00:00Z", "1"))).toBe(false);
  });

  it("an equal lastUpdated falls back to a numeric versionId", () => {
    const same = "2026-09-01T00:00:00Z";
    expect(isOlderCopy(stamp(same, "5"), stamp(same, "4"))).toBe(true);
    expect(isOlderCopy(stamp(same, "5"), stamp(same, "5"))).toBe(false);
    expect(isOlderCopy(stamp(same, "5"), stamp(same, "6"))).toBe(false);
  });

  it("an incoming copy without lastUpdated is compared by versionId (PR #98 review)", () => {
    expect(isOlderCopy(stamp("2026-09-01T00:00:00Z", "7"), stamp(null, "6"))).toBe(true);
    expect(isOlderCopy(stamp("2026-09-01T00:00:00Z", "7"), stamp(null, "8"))).toBe(false);
    expect(isOlderCopy(stamp(null, "7"), stamp("2026-09-01T00:00:00Z", "3"))).toBe(true);
  });

  it("never guesses: a version id that is not a plain number, or a missing one, is not judged older", () => {
    expect(isOlderCopy(stamp(null, "b"), stamp(null, "a"))).toBe(false);
    expect(isOlderCopy(stamp(null, "7"), stamp(null, null))).toBe(false);
    expect(isOlderCopy(stamp(null, null), stamp(null, "7"))).toBe(false);
    expect(isOlderCopy(stamp(null, "7a"), stamp(null, "6"))).toBe(false);
    expect(isOlderCopy(stamp(null, null), stamp(null, null))).toBe(false);
  });
});
