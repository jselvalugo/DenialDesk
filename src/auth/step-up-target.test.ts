import { describe, expect, it } from "vitest";
import { MAX_RETURN_TO_LENGTH, stepUpTarget } from "./step-up-target";

const ID = "0b9f5a5e-1f0a-4c3e-8d6e-2b1a9c7d4e10";
const DEFAULT = { path: "/settings/integrations", route: "/settings/integrations", routeId: null };

describe("stepUpTarget", () => {
  it("keeps the integrations pages, describing a connection by route template plus its UUID", () => {
    expect(stepUpTarget("/settings/integrations")).toEqual(DEFAULT);
    expect(stepUpTarget("/settings/integrations/new")).toEqual({
      path: "/settings/integrations/new",
      route: "/settings/integrations/new",
      routeId: null,
    });
    expect(stepUpTarget(`/settings/integrations/${ID}`)).toEqual({
      path: `/settings/integrations/${ID}`,
      route: "/settings/integrations/[id]",
      routeId: ID,
    });
  });

  it("lowercases the UUID and drops a query string", () => {
    expect(stepUpTarget(`/settings/integrations/${ID.toUpperCase()}?tab=history`)).toEqual({
      path: `/settings/integrations/${ID}`,
      route: "/settings/integrations/[id]",
      routeId: ID,
    });
  });

  it.each([
    "/settings/integrations/not-a-uuid",
    "/settings/integrations/Jane%20Doe%201990-01-01",
    `/settings/integrations/${ID}/edit`,
    `/settings/integrations/${ID}x`,
    "/patients",
    "/patients/abc",
    "/",
    "//evil.example",
    "https://evil.example/x",
    "/\\evil.example",
    "",
    undefined,
    null,
    42,
  ])("falls back to the default page for %j, never echoing it", (value) => {
    expect(stepUpTarget(value)).toEqual(DEFAULT);
  });

  it("refuses a value over the length cap, even one that would otherwise be valid", () => {
    const padded = `/settings/integrations/${ID}?${"a".repeat(MAX_RETURN_TO_LENGTH)}`;
    expect(padded.length).toBeGreaterThan(MAX_RETURN_TO_LENGTH);
    expect(stepUpTarget(padded)).toEqual(DEFAULT);
    const atCap = `/settings/integrations/${ID}?${"a".repeat(MAX_RETURN_TO_LENGTH - 23 - ID.length - 1)}`;
    expect(atCap.length).toBe(MAX_RETURN_TO_LENGTH);
    expect(stepUpTarget(atCap).routeId).toBe(ID);
  });
});
