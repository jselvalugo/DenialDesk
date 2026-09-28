import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// L5: the client IP recorded in audit rows and used by rate limits. `x-nf-client-connection-ip` is
// trustworthy only behind Netlify's edge.

let incoming: Record<string, string> = {};
vi.mock("next/headers", () => ({
  headers: async () => new Headers(incoming),
}));

import { requestContext } from "./request-context";

beforeEach(() => {
  incoming = {};
  for (const name of ["NETLIFY", "NETLIFY_DB_URL", "DEPLOY_ID", "SITE_ID"]) vi.stubEnv(name, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("requestContext client IP", () => {
  it("ignores x-nf-client-connection-ip when not on Netlify (a client could have sent it)", async () => {
    incoming = { "x-nf-client-connection-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1, 192.0.2.9" };
    expect((await requestContext()).ip).toBe("192.0.2.9");
  });

  it("is null off Netlify with a forged Netlify header and nothing else", async () => {
    incoming = { "x-nf-client-connection-ip": "203.0.113.7" };
    expect((await requestContext()).ip).toBeNull();
  });

  it("trusts x-nf-client-connection-ip on Netlify", async () => {
    vi.stubEnv("NETLIFY", "true");
    incoming = { "x-nf-client-connection-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1, 192.0.2.9" };
    expect((await requestContext()).ip).toBe("203.0.113.7");
  });

  it("still prefers the Azure client IP header, then the last X-Forwarded-For hop, and keeps the user agent", async () => {
    incoming = {
      "x-azure-clientip": "192.0.2.50",
      "x-forwarded-for": "198.51.100.1",
      "user-agent": "agent/1",
    };
    expect(await requestContext()).toEqual({ ip: "192.0.2.50", userAgent: "agent/1" });
    incoming = { "x-forwarded-for": "198.51.100.1, 192.0.2.9" };
    expect((await requestContext()).ip).toBe("192.0.2.9");
  });
});
