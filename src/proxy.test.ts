import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "./proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

function nonceIn(csp: string | null): string | undefined {
  return csp?.match(/'nonce-([^']+)'/)?.[1];
}

describe("proxy (SC-B10.1)", () => {
  it("sends the same fresh nonce in the response CSP and to the renderer", () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = proxy(new NextRequest("https://denialdesk.test/login"));
    const csp = response.headers.get("content-security-policy");
    const nonce = nonceIn(csp);
    expect(nonce).toBeDefined();
    // NextResponse.next({ request: { headers } }) forwards overridden request headers this way.
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain(" ws:");
  });

  it("uses a new nonce for every request", () => {
    const first = proxy(new NextRequest("https://denialdesk.test/"));
    const second = proxy(new NextRequest("https://denialdesk.test/"));
    expect(nonceIn(first.headers.get("content-security-policy"))).not.toBe(
      nonceIn(second.headers.get("content-security-policy")),
    );
  });

  it("ignores a nonce or policy the client sends", () => {
    const response = proxy(
      new NextRequest("https://denialdesk.test/", {
        headers: { "x-nonce": "attacker", "content-security-policy": "script-src *" },
      }),
    );
    expect(response.headers.get("x-middleware-request-x-nonce")).not.toBe("attacker");
    expect(response.headers.get("content-security-policy")).not.toContain("script-src *");
  });

  it("covers every page but skips only static build assets", () => {
    const source = config.matcher[0]?.source ?? "";
    const matches = (path: string) => new RegExp(`^${source}$`).test(path);
    for (const path of ["/", "/login", "/claims/123", "/api/preview/seed", "/.well-known/jwks.json"]) {
      expect(matches(path), path).toBe(true);
    }
    for (const path of ["/_next/static/chunks/app.js", "/_next/image", "/icon.png", "/brand/logo.svg"]) {
      expect(matches(path), path).toBe(false);
    }
  });
});
