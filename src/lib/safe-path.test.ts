import { describe, expect, it } from "vitest";
import { safeInternalPath } from "./safe-path";

describe("safeInternalPath", () => {
  it.each([
    "/\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "//x",
    "https://x",
    "http://evil.com",
    "javascript:alert(1)",
    "/\\/evil.com",
    " /patients",
    "/patients\n",
    "",
  ])("refuses %j, falling back to the default", (value) => {
    expect(safeInternalPath(value)).toBe("/");
  });

  it("falls back to a custom fallback when given one", () => {
    expect(safeInternalPath("//evil.com", "/patients")).toBe("/patients");
  });

  it.each([
    ["/", "/"],
    ["/patients", "/patients"],
    ["/patients/", "/patients/"],
    ["/patients/abc-123", "/patients/abc-123"],
    ["/settings/integrations", "/settings/integrations"],
    ["/settings/integrations/new", "/settings/integrations/new"],
    ["/settings/integrations/abc?tab=history", "/settings/integrations/abc?tab=history"],
    // The allow-list applies to the pathname; a query string on an allowed path is kept.
    ["/patients?page=2", "/patients?page=2"],
    ["/settings/integrations?tab=history", "/settings/integrations?tab=history"],
    ["/?welcome=1", "/?welcome=1"],
  ])("keeps a valid, allow-listed path %j", (value, expected) => {
    expect(safeInternalPath(value)).toBe(expected);
  });

  it("never lets a query string make a path outside the allow-list pass, or hide one that is inside", () => {
    expect(safeInternalPath("/claims/abc?next=/patients")).toBe("/");
    expect(safeInternalPath("/claims?x=/patients/1", "/settings/integrations")).toBe(
      "/settings/integrations",
    );
    expect(safeInternalPath("/patients/../claims/1?x=1", "/settings/integrations")).toBe(
      "/settings/integrations",
    );
  });

  it("uses a non-root fallback for every refusal, and still returns the root for an exact /", () => {
    for (const value of ["//evil.com", "https://evil.com", "/claims/abc", "", undefined, "/\\evil.com"]) {
      expect(safeInternalPath(value, "/settings/integrations")).toBe("/settings/integrations");
    }
    expect(safeInternalPath("/", "/settings/integrations")).toBe("/");
  });

  it("refuses a path outside the allow-list even when otherwise well-formed", () => {
    expect(safeInternalPath("/claims/abc")).toBe("/");
    expect(safeInternalPath("/settings")).toBe("/");
  });

  it("refuses a non-string value", () => {
    expect(safeInternalPath(undefined)).toBe("/");
    expect(safeInternalPath(null)).toBe("/");
    expect(safeInternalPath(42)).toBe("/");
  });
});
