import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

function nonceIn(csp: string | null): string | undefined {
  return csp?.match(/'nonce-([^']+)'/)?.[1];
}

describe("proxy (SC-B10.1)", () => {
  it("sends the same fresh nonce in the response CSP and to the renderer", () => {
    const response = proxy(new NextRequest("https://denialdesk.test/login"));
    const csp = response.headers.get("content-security-policy");
    const nonce = nonceIn(csp);
    expect(nonce).toBeDefined();
    // NextResponse.next({ request: { headers } }) forwards overridden request headers this way.
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(csp).not.toContain("'unsafe-eval'");
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

  it("covers every page, and skips only the static paths next.config.ts covers", () => {
    // Next's own matcher compiler, so the test cannot drift from how Next reads `config`.
    const matches = (path: string) => unstable_doesMiddlewareMatch({ config, url: path });
    for (const path of [
      "/",
      "/login",
      "/claims/123",
      "/claims?_rsc=abc",
      "/api/preview/seed",
      "/.well-known/jwks.json",
      "/icon.png.html",
      "/_next/staticx",
      "/brandx",
    ]) {
      expect(matches(path), path).toBe(true);
    }
    for (const path of ["/_next/static/chunks/app.js", "/_next/image", "/icon.png", "/brand/logo.svg"]) {
      expect(matches(path), path).toBe(false);
    }
  });
});
