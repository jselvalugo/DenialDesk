import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, newNonce, STATIC_ASSET_CSP } from "./csp";

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name ?? "", values];
    }),
  );
}

describe("contentSecurityPolicy (SC-B10.1)", () => {
  const csp = contentSecurityPolicy("abc123==");
  const policy = directives(csp);

  it("allows scripts only by nonce, with strict-dynamic", () => {
    expect(policy.get("script-src")).toEqual(["'self'", "'nonce-abc123=='", "'strict-dynamic'"]);
  });

  it("never allows eval or inline scripts, in any mode", () => {
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("'wasm-unsafe-eval'");
    expect(policy.get("script-src")).not.toContain("'unsafe-inline'");
    expect(policy.get("default-src")).not.toContain("'unsafe-inline'");
  });

  it("denies plugins, base-tag rewrites, and framing", () => {
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'none'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("keeps every other fetch on our own origin (SC-A3.2)", () => {
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("connect-src")).toEqual(["'self'"]);
    expect(policy.get("font-src")).toEqual(["'self'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
    for (const values of policy.values()) {
      for (const value of values) expect(value).not.toMatch(/^(https?:|wss?:|\*)/);
    }
  });
});

describe("STATIC_ASSET_CSP", () => {
  it("lets nothing load, run, or frame a static asset or a not-found page under those paths", () => {
    const policy = directives(STATIC_ASSET_CSP);
    expect(policy.get("default-src")).toEqual(["'none'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'none'"]);
    expect(policy.has("sandbox")).toBe(true);
  });
});

describe("newNonce", () => {
  it("is 128 bits of base64 and different every time", () => {
    const nonces = new Set(Array.from({ length: 100 }, () => newNonce()));
    expect(nonces.size).toBe(100);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(Buffer.from(nonce, "base64")).toHaveLength(16);
    }
  });
});
