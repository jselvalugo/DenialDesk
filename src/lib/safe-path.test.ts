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
  ])("keeps a valid, allow-listed path %j", (value, expected) => {
    expect(safeInternalPath(value)).toBe(expected);
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
